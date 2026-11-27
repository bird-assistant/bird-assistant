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


def test_planning_only_config_shares_credentials_and_workspace_with_journal(monkeypatch):
    monkeypatch.delenv("BIRD_BUSINESS_QWEN_API_KEY", raising=False)
    monkeypatch.delenv("BIRD_BUSINESS_QWEN_BASE_URL", raising=False)
    settings = BusinessSettings(trip_api_key="shared-test-only", trip_workspace="course-workspace")
    assert settings.qwen_api_key.get_secret_value() == "shared-test-only"
    assert (
        settings.qwen_base_url == "https://course-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
    )
    reverse = BusinessSettings(qwen_api_key="writer-test-only")
    assert reverse.trip_api_key == reverse.qwen_api_key
    explicit = BusinessSettings(
        trip_api_key="planning-test-only",
        qwen_api_key="writing-test-only",
        trip_workspace="course-workspace",
        qwen_base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
    )
    assert explicit.qwen_api_key.get_secret_value() == "writing-test-only"
    assert explicit.trip_api_key.get_secret_value() == "planning-test-only"
    assert explicit.qwen_base_url == "https://dashscope.aliyuncs.com/compatible-mode/v1"


def test_writing_capabilities_are_authenticated_and_do_not_expose_credentials(setup):
    client, app, calls, _ = setup
    reply = client.get("/api/v1/journal/capabilities")
    assert reply.status_code == 200
    assert reply.headers["cache-control"] == "no-store"
    assert reply.json() == {
        "version": 1,
        "configured": True,
        "textModel": "qwen-plus",
        "imageModel": "qwen3-vl-plus",
        "asrEnabled": False,
        "sharedPlanningCredential": True,
    }
    assert "qwen-test-secret" not in reply.text
    assert not calls
    client.headers.pop("Authorization")
    assert client.get("/api/v1/journal/capabilities").status_code == 401
    client.headers["Authorization"] = "Bearer " + app.state.auth.issue("wx:test:writer")
    app.state.settings.qwen_api_key = app.state.settings.qwen_api_key.__class__("")
    assert client.get("/api/v1/journal/capabilities").json()["configured"] is False


@pytest.mark.parametrize(
    ("status", "code"),
    [
        (401, "PROVIDER_AUTH"),
        (403, "PROVIDER_AUTH"),
        (404, "MODEL_UNAVAILABLE"),
        (400, "PROVIDER_INPUT"),
        (429, "RATE_LIMITED"),
        (500, "UPSTREAM_UNAVAILABLE"),
    ],
)
def test_provider_failures_identify_the_stage_without_echoing_provider_secrets(monkeypatch, status, code):
    from urllib.error import HTTPError

    from bird_business import writing

    class Transport:
        def open(self, request, timeout):
            raise HTTPError(request.full_url, status, "private provider details", {}, None)

    monkeypatch.setattr(writing, "build_opener", lambda *_: Transport())
    with pytest.raises(ServiceError) as error:
        writing.generate(
            BusinessSettings(qwen_api_key="test-only-secret"), writing.Brief.model_validate(brief()), []
        )
    assert error.value.code == code
    assert "private provider details" not in str(error.value)


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


def test_photo_journal_returns_independent_overview_and_selected_photo_captions(setup):
    client, app, _, _ = setup
    pictures = [picture(), {**picture(), "id": "p-2", "label": "第二张"}]
    captions = [{"id": "p-1", "text": "鸟停在枝头。"}, {"id": "p-2", "text": "鸟在地面活动。"}]
    app.state.writing_upstream = lambda *_: {
        "title": "这次的照片",
        "body": "几张照片里的观察。",
        "design": {"style": "minimal", "variant": 2},
        "captions": captions,
    }
    reply = client.post("/api/v1/journal/suggestions", json=brief(purpose="照片手帐", images=pictures))
    assert reply.status_code == 200
    assert reply.json()["captions"] == captions
    assert reply.json()["body"] == "几张照片里的观察。"
    assert app.state.community.db.execute("SELECT count(*) FROM publications").fetchone()[0] == 0


@pytest.mark.parametrize(
    "captions",
    [
        [None],
        [{"id": "other", "text": "不属于所选照片"}],
        [{"id": "p-1", "text": "一"}, {"id": "p-1", "text": "二"}],
        [{"id": "p-1", "text": " "}],
        [{"id": "p-1", "text": "长" * 81}],
        [{"id": "p-1", "text": "合法文字", "path": "private-path"}],
    ],
)
def test_invalid_captions_are_rejected_without_returning_partial_suggestions(setup, captions):
    client, app, _, _ = setup
    app.state.writing_upstream = lambda *_: {
        "title": "观察",
        "body": "原始内容仍保留。",
        "design": {"style": "nature", "variant": 1},
        "captions": captions,
    }
    reply = client.post("/api/v1/journal/suggestions", json=brief(images=[picture()]))
    assert reply.status_code == 502
    assert reply.json()["error"]["code"] == "INVALID_OUTPUT"
    assert "captions" not in reply.json()


def test_older_writing_response_remains_compatible_without_empty_caption_field(setup):
    client, _, _, _ = setup
    reply = client.post("/api/v1/journal/suggestions", json=brief())
    assert reply.status_code == 200
    assert "captions" not in reply.json()


def test_photo_journal_prompt_keeps_existing_text_and_picture_ids_with_plain_language_default(monkeypatch):
    import json

    from bird_business import writing

    prompt = json.dumps(
        {
            "instructions": "根据照片整理成自然的观察手帐",
            "existingText": {"title": "原来的标题", "body": "我还不能确定是什么鸟。"},
        },
        ensure_ascii=False,
    )
    requested = writing.Brief.model_validate(brief(prompt=prompt, purpose="照片手帐", images=[picture()]))
    calls = []

    class Transport:
        def open(self, request, timeout):
            payload = json.loads(request.data)
            calls.append(payload)
            system = payload["messages"][0]["content"]
            assert "自然简短" in system and "除非用户明确要求" in system
            assert "captions" in system
            text = json.loads(payload["messages"][1]["content"][0]["text"])
            assert text["prompt"] == prompt
            assert text["selectedPictures"] == [{"id": "p-1", "label": "用户勾选的照片"}]
            assert payload["model"] == "qwen3-vl-plus"
            return BytesIO(
                json.dumps(
                    {
                        "choices": [
                            {
                                "finish_reason": "stop",
                                "message": {
                                    "content": json.dumps(
                                        {
                                            "title": "观察",
                                            "body": "我还不能确定是什么鸟。",
                                            "design": {"style": "nature", "variant": 1},
                                        }
                                    )
                                },
                            }
                        ]
                    }
                ).encode()
            )

    monkeypatch.setattr(writing, "build_opener", lambda *_: Transport())
    writing.generate(BusinessSettings(qwen_api_key="offline-test"), requested, ["fixture-copy"])
    assert len(calls) == 1
