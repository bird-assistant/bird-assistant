from __future__ import annotations

import base64
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from pydantic import ValidationError

from bird_business.app import create_app
from bird_business.config import BusinessSettings
from bird_common.errors import ServiceError


@pytest.fixture
def setup(tmp_path):
    settings = BusinessSettings(
        environment="test",
        database_path=tmp_path / "writing.db",
        api_keys="server-test",
        allow_anonymous=False,
        mobile_signing_key="a" * 64,
        qwen_api_key="qwen-test-secret",
        qwen_daily_requests=2,
    )
    app = create_app(settings)
    with TestClient(app) as client:
        client.headers["Authorization"] = "Bearer " + app.state.auth.issue("wx:test:writer")
        calls = []

        def fake(_settings, brief, images):
            calls.append((brief, images))
            return {
                "title": "林间的一刻",
                "body": "把眼前这一刻留在纸上。",
                "design": {"style": "nature", "variant": 1},
            }

        app.state.writing_upstream = fake
        yield client, app, calls, settings


def brief(**changes):
    return {
        "version": 1,
        "requestId": "writing-1",
        "prompt": "整理成一段简短的观察感想",
        "purpose": "手帐",
        "maxChars": 120,
        "images": [],
        **changes,
    }


def picture(size=(80, 50)):
    output = BytesIO()
    Image.new("RGB", size, "green").save(output, format="PNG")
    return {
        "id": "p-1",
        "label": "用户勾选的照片",
        "dataUrl": "data:image/png;base64," + base64.b64encode(output.getvalue()).decode(),
    }


def test_mobile_identity_photo_redraw_and_preview_contract(setup):
    client, app, calls, _ = setup
    reply = client.post("/api/v1/journal/suggestions", json=brief(images=[picture()]))
    assert reply.status_code == 200
    assert reply.json()["requestId"] == "writing-1"
    assert reply.json()["design"] == {"style": "nature", "variant": 1}
    assert reply.headers["cache-control"] == "no-store"
    assert len(calls) == 1
    image = Image.open(BytesIO(base64.b64decode(calls[0][1][0].split(",")[1])))
    assert image.size == (80, 50) and image.format == "JPEG" and not image.getexif()
    assert app.state.community.db.execute("SELECT count(*) FROM publications").fetchone()[0] == 0


@pytest.mark.parametrize(
    "changes",
    [
        {"images": [{**picture(), "dataUrl": "https://example.com/private.jpg"}]},
        {"images": [picture(), picture()]},
        {"images": [picture((1025, 2))]},
        {"images": [{**picture(), "path": "wxfile://private"}]},
        {"maxChars": 601},
        {"maxChars": 100.5},
        {"prompt": " "},
        {"model": "arbitrary"},
    ],
)
def test_invalid_input_does_not_consume_quota_or_call_model(setup, changes):
    client, _, calls, _ = setup
    assert client.post("/api/v1/journal/suggestions", json=brief(**changes)).status_code == 422
    assert not calls


def test_body_bound_authentication_and_unconfigured_provider(setup):
    client, app, calls, _ = setup
    assert client.post("/api/v1/journal/suggestions", content=b" " * (6 * 1024 * 1024 + 1)).status_code == 413
    client.headers.pop("Authorization")
    assert client.post("/api/v1/journal/suggestions", json=brief()).status_code == 401
    client.headers["Authorization"] = "Bearer " + app.state.auth.issue("wx:test:writer")
    app.state.settings.qwen_api_key = app.state.settings.qwen_api_key.__class__("")
    reply = client.post("/api/v1/journal/suggestions", json=brief())
    assert reply.status_code == 503 and reply.json()["error"]["code"] == "NOT_CONFIGURED"
    assert not calls


def test_per_user_daily_quota_survives_restart_and_isolates_members(setup):
    client, app, calls, settings = setup
    for _ in range(2):
        assert client.post("/api/v1/journal/suggestions", json=brief(purpose="论坛草稿")).status_code == 200
    assert client.post("/api/v1/journal/suggestions", json=brief()).status_code == 429
    assert len(calls) == 2
    second = create_app(settings)
    with TestClient(second) as fresh:
        fresh.headers["Authorization"] = "Bearer " + second.state.auth.issue("wx:test:writer")
        second.state.writing_upstream = app.state.writing_upstream
        assert fresh.post("/api/v1/journal/suggestions", json=brief()).status_code == 429
        fresh.headers["Authorization"] = "Bearer " + second.state.auth.issue("wx:test:other")
        assert fresh.post("/api/v1/journal/suggestions", json=brief()).status_code == 200


def test_output_validation_timeout_and_no_retry(setup):
    client, app, calls, _ = setup

    def invalid_output(*_):
        calls.append("invalid")
        return {"title": "hello", "body": "text", "design": {"style": "nature", "variant": 9}}

    app.state.writing_upstream = invalid_output
    reply = client.post("/api/v1/journal/suggestions", json=brief())
    assert reply.status_code == 502 and reply.json()["error"]["code"] == "INVALID_OUTPUT"

    def unavailable(*_):
        calls.append("timeout")
        raise ServiceError("TIMEOUT", "writing provider unavailable", 504)

    app.state.writing_upstream = unavailable
    assert client.post("/api/v1/journal/suggestions", json=brief()).status_code == 504
    assert calls == ["invalid", "timeout"]
    assert app.state.writing_slots.acquire(False) and app.state.writing_slots.acquire(False)
    app.state.writing_slots.release()
    app.state.writing_slots.release()


def test_global_concurrency_fails_without_model_call(setup):
    client, app, calls, _ = setup
    app.state.writing_slots.acquire()
    app.state.writing_slots.acquire()
    try:
        assert client.post("/api/v1/journal/suggestions", json=brief()).status_code == 429
        assert not calls
    finally:
        app.state.writing_slots.release()
        app.state.writing_slots.release()


def test_provider_host_is_constrained_and_secret_not_in_settings_repr():
    with pytest.raises(ValidationError):
        BusinessSettings(qwen_base_url="https://untrusted.example/compatible-mode/v1")
    assert "not-visible-key" not in repr(BusinessSettings(qwen_api_key="not-visible-key"))


@pytest.mark.parametrize("mode", ["valid", "invalid_json", "oversized", "truncated"])
def test_provider_http_payload_output_bound_and_no_retry(monkeypatch, mode):
    import json

    from bird_business import writing

    calls = []
    content = {"title": "一刻", "body": "眼前的观察。", "design": {"style": "nature", "variant": 1}}
    raw = json.dumps(
        {
            "choices": [
                {
                    "finish_reason": "length" if mode == "truncated" else "stop",
                    "message": {"content": json.dumps(content)},
                }
            ]
        }
    ).encode()
    if mode == "invalid_json":
        raw = b"not json"
    if mode == "oversized":
        raw = b" " * 70_000

    class Opener:
        def open(self, request, timeout):
            calls.append(request)
            payload = json.loads(request.data)
            assert payload["model"] == "qwen-plus"
            assert payload["enable_thinking"] is False
            assert payload["response_format"] == {"type": "json_object"}
            assert timeout == 20 and request.get_header("Authorization") == "Bearer server-only-test"
            return BytesIO(raw)

    monkeypatch.setattr(writing, "build_opener", lambda *_: Opener())
    settings = BusinessSettings(qwen_api_key="server-only-test")
    if mode == "valid":
        assert writing.generate(settings, writing.Brief.model_validate(brief()), []) == content
    else:
        with pytest.raises(ServiceError) as error:
            writing.generate(settings, writing.Brief.model_validate(brief()), [])
        assert error.value.code == "INVALID_OUTPUT"
    assert len(calls) == 1


@pytest.mark.parametrize("with_image", [False, True])
def test_workspace_writing_uses_text_or_vision_model_without_redirect_or_retry(monkeypatch, with_image):
    import json

    from bird_business import writing

    calls = []
    expected = {"title": "一刻", "body": "来自原稿的观察。", "design": {"style": "nature", "variant": 1}}
    images = ["data:image/jpeg;base64,offline-fixture"] if with_image else []

    class Transport:
        def open(self, request, timeout):
            calls.append(request.full_url)
            assert (
                request.full_url
                == "https://example-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions"
            )
            payload = json.loads(request.data)
            assert payload["model"] == ("qwen3-vl-plus" if with_image else "qwen-plus")
            content = payload["messages"][1]["content"]
            assert [part["type"] for part in content] == (["text", "image_url"] if with_image else ["text"])
            return BytesIO(
                json.dumps(
                    {"choices": [{"finish_reason": "stop", "message": {"content": json.dumps(expected)}}]}
                ).encode()
            )

    monkeypatch.setattr(writing, "build_opener", lambda *_: Transport())
    settings = BusinessSettings(
        qwen_api_key="offline-fixture",
        qwen_base_url="https://example-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
    )
    assert writing.generate(settings, writing.Brief.model_validate(brief()), images) == expected
    assert len(calls) == 1
