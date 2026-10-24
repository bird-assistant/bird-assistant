from __future__ import annotations

import asyncio
from threading import Event
from unittest.mock import Mock

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image
from starlette.websockets import WebSocketDisconnect

import bird_vision.api as api_module
from bird_vision.app import create_app
from bird_vision.config import Settings


@pytest.fixture
async def api_client(test_settings):
    app = create_app(test_settings)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client,
    ):
        yield app, client


@pytest.fixture
def multipart_frame(jpeg_bytes):
    request = httpx.Request(
        "POST",
        "http://test/frames",
        data={"frame_id": "frame-1"},
        files={"frame": ("frame.jpg", jpeg_bytes, "image/jpeg")},
    )
    return request.read(), {"Content-Type": request.headers["content-type"]}


def test_health_and_readiness(test_settings) -> None:
    with TestClient(create_app(test_settings)) as client:
        health = client.get("/healthz")
        assert health.status_code == 200
        assert health.json()["status"] == "ok"
        ready = client.get("/readyz")
        assert ready.status_code == 200
        assert ready.json()["status"] == "ready"
        assert ready.json()["models"][0]["details"] == {}


def test_production_readiness_requires_real_cuda_backends(test_settings) -> None:
    with TestClient(create_app(test_settings)) as client:
        client.app.state.settings.environment = "production"
        not_ready = client.get("/readyz")
        assert not_ready.status_code == 503

        client.app.state.detector.backend = "ultralytics-yolo"
        client.app.state.detector.device = "cuda:0"
        client.app.state.species.backend = "open-clip"
        client.app.state.species.device = "cuda:0"
        ready = client.get("/readyz")
        assert ready.status_code == 200
        assert ready.json()["status"] == "ready"


def test_untrusted_request_id_is_replaced(test_settings) -> None:
    with TestClient(create_app(test_settings)) as client:
        response = client.get("/healthz", headers={"X-Request-ID": "bad request id"})
        assert response.headers["X-Request-ID"].startswith("req_")


def test_session_frame_and_websocket(test_settings, jpeg_bytes: bytes) -> None:
    with TestClient(create_app(test_settings)) as client:
        created = client.post("/api/v1/vision/sessions", json={"client_session_id": "wx-activity-1"})
        assert created.status_code == 201
        session_id = created.json()["session_id"]
        session = client.get(f"/api/v1/vision/sessions/{session_id}")
        assert session.json()["client_session_id"] == "wx-activity-1"
        assert session.json()["region_code"] is None

        with client.websocket_connect(f"/api/v1/vision/sessions/{session_id}/events") as websocket:
            assert websocket.receive_json()["type"] == "vision.session.started"
            accepted = client.post(
                f"/api/v1/vision/sessions/{session_id}/frames",
                data={"frame_id": "frame-1"},
                files={"frame": ("frame.jpg", jpeg_bytes, "image/jpeg")},
            )
            assert accepted.status_code == 202
            assert accepted.json()["frame_id"] == "frame-1"
            result = websocket.receive_json()
            assert result["type"] == "vision.frame.result"
            assert result["frame_id"] == "frame-1"
            assert result["tracks"][0]["state"] == "tentative"
            assert result["tracks"][0]["visibility"] == "detected"
            assert result["tracks"][0]["species"]["state"] == "waiting_for_quality"


def test_historical_session_uses_session_coordinates_and_old_capture_time(
    test_settings, jpeg_bytes: bytes
) -> None:
    with TestClient(create_app(test_settings)) as client:
        created = client.post(
            "/api/v1/vision/sessions",
            json={
                "observation_mode": "historical",
                "latitude": 31.8206,
                "longitude": 117.2272,
                "region_code": "CN",
            },
        )
        assert created.status_code == 201
        assert created.json()["observation_mode"] == "historical"
        assert created.json()["latitude"] == 31.8206
        session_id = created.json()["session_id"]
        with client.websocket_connect(f"/api/v1/vision/sessions/{session_id}/events") as websocket:
            websocket.receive_json()
            accepted = client.post(
                f"/api/v1/vision/sessions/{session_id}/frames",
                data={"frame_id": "historic", "captured_at": "2024-05-10T18:30:00+08:00"},
                files={"frame": ("frame.jpg", jpeg_bytes, "image/jpeg")},
            )
            assert accepted.status_code == 202
            result = websocket.receive_json()
        assert result["observation_context"] == {
            "observed_at": "2024-05-10T18:30:00+08:00",
            "time_source": "captured_at",
            "time_precision": "exact",
            "latitude": 31.8206,
            "longitude": 117.2272,
            "coordinate_source": "session",
            "region_code": "CN",
        }


def test_frame_metadata_overrides_session_coordinates(test_settings, jpeg_bytes: bytes) -> None:
    with TestClient(create_app(test_settings)) as client:
        created = client.post(
            "/api/v1/vision/sessions",
            json={
                "observation_mode": "historical",
                "latitude": 31.8206,
                "longitude": 117.2272,
            },
        )
        session_id = created.json()["session_id"]
        with client.websocket_connect(f"/api/v1/vision/sessions/{session_id}/events") as websocket:
            websocket.receive_json()
            accepted = client.post(
                f"/api/v1/vision/sessions/{session_id}/frames",
                data={
                    "frame_id": "frame-location",
                    "captured_at": "2025-11-01T00:00:00Z",
                    "capture_time_precision": "month",
                    "latitude": 39.9042,
                    "longitude": 116.4074,
                },
                files={"frame": ("frame.jpg", jpeg_bytes, "image/jpeg")},
            )
            assert accepted.status_code == 202
            result = websocket.receive_json()

        assert result["observation_context"] == {
            "observed_at": "2025-11-01T00:00:00Z",
            "time_source": "captured_at",
            "time_precision": "month",
            "latitude": 39.9042,
            "longitude": 116.4074,
            "coordinate_source": "frame",
            "region_code": None,
        }


def test_live_session_rejects_old_capture_time_and_incomplete_coordinates(
    test_settings, jpeg_bytes: bytes
) -> None:
    with TestClient(create_app(test_settings)) as client:
        incomplete = client.post("/api/v1/vision/sessions", json={"latitude": 31.8206})
        assert incomplete.status_code == 422
        session_id = client.post("/api/v1/vision/sessions", json={}).json()["session_id"]
        old = client.post(
            f"/api/v1/vision/sessions/{session_id}/frames",
            data={"frame_id": "old", "captured_at": "2024-05-10T18:30:00+08:00"},
            files={"frame": ("frame.jpg", jpeg_bytes, "image/jpeg")},
        )
        assert old.status_code == 422
        assert old.json()["error"]["code"] == "CAPTURED_AT_CLOCK_SKEW"

        session = client.post(
            "/api/v1/vision/sessions", json={"observation_mode": "historical"}
        ).json()
        missing_time = client.post(
            f"/api/v1/vision/sessions/{session['session_id']}/frames",
            data={"frame_id": "missing-time"},
            files={"frame": ("frame.jpg", jpeg_bytes, "image/jpeg")},
        )
        assert missing_time.status_code == 422
        assert missing_time.json()["error"]["code"] == "CAPTURED_AT_REQUIRED"


async def test_duplicate_frame_id_is_rejected_before_decode(
    api_client, jpeg_bytes: bytes, monkeypatch
) -> None:
    app, client = api_client
    decode = Mock(wraps=api_module.decode_image)
    monkeypatch.setattr(api_module, "decode_image", decode)
    session_id = (await client.post("/api/v1/vision/sessions", json={})).json()["session_id"]
    path = f"/api/v1/vision/sessions/{session_id}/frames"
    first = await client.post(
        path, data={"frame_id": "same"}, files={"frame": ("frame.jpg", jpeg_bytes, "image/jpeg")}
    )
    assert first.status_code == 202
    session = app.state.sessions.get(session_id)
    await asyncio.wait_for(session.queue.join(), timeout=2)
    session.last_accepted_monotonic = None

    second = await client.post(
        path, data={"frame_id": "same"}, files={"frame": ("broken.jpg", b"invalid", "image/jpeg")}
    )

    assert second.status_code == 409
    assert second.json()["error"]["code"] == "FRAME_ID_DUPLICATE"
    assert decode.call_count == 1
    assert session.pending_frame_ids == set()
    assert not session.uploading
    assert app.state.sessions._buffered_image_bytes == 0


def test_api_key_required(jpeg_bytes: bytes) -> None:
    settings = Settings(
        environment="test",
        detector_backend="mock",
        species_backend="disabled",
        allow_anonymous=False,
        api_keys="secret-test-key",
    )
    with TestClient(create_app(settings)) as client:
        denied = client.post("/api/v1/vision/sessions", json={})
        assert denied.status_code == 401
        allowed = client.post(
            "/api/v1/vision/sessions",
            json={},
            headers={"Authorization": "Bearer secret-test-key"},
        )
        assert allowed.status_code == 201


def test_sessions_are_scoped_to_api_key() -> None:
    settings = Settings(
        environment="test",
        detector_backend="mock",
        species_backend="disabled",
        allow_anonymous=False,
        api_keys="key-one,key-two",
    )
    with TestClient(create_app(settings)) as client:
        created = client.post(
            "/api/v1/vision/sessions",
            json={},
            headers={"Authorization": "Bearer key-one"},
        )
        session_id = created.json()["session_id"]
        hidden = client.get(
            f"/api/v1/vision/sessions/{session_id}",
            headers={"Authorization": "Bearer key-two"},
        )
        assert hidden.status_code == 404


def test_openapi_documents_realtime_contract(test_settings) -> None:
    schema = create_app(test_settings).openapi()
    assert "/api/v1/vision/sessions/{session_id}/frames" in schema["paths"]
    # OpenAPI does not model WebSocket operations; the event contract lives in API.md.
    assert "/api/v1/vision/sessions/{session_id}/events" not in schema["paths"]
    assert "FrameAcceptedResponse" in schema["components"]["schemas"]
    assert "/api/v1/species/catalog" in schema["paths"]
    assert "/api/v1/species/occurrence/cache/prepare" in schema["paths"]


def test_occurrence_cache_prepare_reports_unavailable_for_disabled_provider(test_settings) -> None:
    with TestClient(create_app(test_settings)) as client:
        response = client.post(
            "/api/v1/species/occurrence/cache/prepare",
            json={
                "latitude": 31.8206,
                "longitude": 117.2272,
                "observed_at": "2026-05-28T19:06:51+08:00",
                "time_precision": "exact",
            },
        )
    assert response.status_code == 200
    assert response.json() == {
        "status": "unavailable",
        "source": None,
        "candidate_count": 0,
    }


def test_catalog_info_and_search_are_available_without_loading_model(tmp_path) -> None:
    catalog = tmp_path / "catalog.csv"
    catalog.write_text(
        "species_id,scientific_name,common_name_zh,common_name_en,region_codes,"
        "taxon_source,taxon_version,license,enabled\n"
        "avibase-F2858F9F,Egretta garzetta,白鹭,Little Egret,CN,AviList,v2026,"
        "CC BY 4.0,true\n",
        encoding="utf-8",
    )
    settings = Settings(
        environment="test",
        detector_backend="mock",
        species_backend="disabled",
        species_catalog_path=catalog,
        allow_anonymous=True,
    )
    with TestClient(create_app(settings)) as client:
        info = client.get("/api/v1/species/catalog/info")
        assert info.status_code == 200
        assert info.json()["total_species"] == 1
        result = client.get("/api/v1/species/catalog", params={"q": "白鹭", "region_code": "cn"})
        assert result.status_code == 200
        assert result.json()["items"][0]["scientific_name"] == "Egretta garzetta"


def test_custom_validation_error_is_json_safe(test_settings) -> None:
    with TestClient(create_app(test_settings)) as client:
        response = client.post("/api/v1/vision/sessions", json={"region_code": "中国"})
    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert body["error"]["details"][0]["loc"] == ["body", "region_code"]
    assert "input" not in body["error"]["details"][0]


def test_unmatched_routes_do_not_create_high_cardinality_metrics(test_settings) -> None:
    with TestClient(create_app(test_settings)) as client:
        client.get("/does-not-exist-one")
        client.get("/does-not-exist-two")
        metrics = client.get("/metrics").text
    assert 'path="__unmatched__"' in metrics
    assert "does-not-exist-one" not in metrics
    assert "does-not-exist-two" not in metrics


def test_per_principal_session_quota_is_enforced(test_settings) -> None:
    settings = test_settings.model_copy(update={"max_sessions": 2, "max_sessions_per_principal": 1})
    with TestClient(create_app(settings)) as client:
        assert client.post("/api/v1/vision/sessions", json={}).status_code == 201
        rejected = client.post("/api/v1/vision/sessions", json={})
    assert rejected.status_code == 429
    assert rejected.json()["error"]["code"] == "PRINCIPAL_SESSION_CAPACITY_EXCEEDED"


@pytest.mark.parametrize(
    ("case", "status", "code"),
    [
        ("missing-credential", 401, "AUTH_REQUIRED"),
        ("invalid-credential", 401, "AUTH_INVALID"),
        ("foreign-session", 404, "SESSION_NOT_FOUND"),
        ("missing-session", 404, "SESSION_NOT_FOUND"),
        ("closed-session", 404, "SESSION_NOT_FOUND"),
    ],
)
async def test_frame_auth_and_session_checks_do_not_read_multipart_body(
    api_client, monkeypatch, case, status, code
) -> None:
    app, client = api_client
    app.state.settings.allow_anonymous = False
    app.state.settings.api_keys = "key-one,key-two"
    owner = {"Authorization": "Bearer key-one"}
    session_id = (await client.post("/api/v1/vision/sessions", json={}, headers=owner)).json()["session_id"]
    headers = {"Content-Type": "multipart/form-data; boundary=test", **owner}
    if case == "missing-credential":
        headers.pop("Authorization")
    elif case == "invalid-credential":
        headers["Authorization"] = "Bearer invalid"
    elif case == "foreign-session":
        headers["Authorization"] = "Bearer key-two"
    elif case == "missing-session":
        session_id = "vs_missing"
    else:
        await app.state.sessions.close(session_id, wait_timeout=None)

    read_body = Mock()
    decode = Mock(side_effect=AssertionError("rejected request reached decode"))
    monkeypatch.setattr(api_module, "decode_image", decode)

    async def body():
        read_body()
        yield b"malformed multipart that must not be parsed"

    response = await client.post(
        f"/api/v1/vision/sessions/{session_id}/frames", headers=headers, content=body()
    )

    assert response.status_code == status
    assert response.json()["error"]["code"] == code
    read_body.assert_not_called()
    decode.assert_not_called()
    assert app.state.sessions._uploads == []
    assert app.state.sessions._buffered_image_bytes == 0


@pytest.mark.parametrize(
    ("capacity", "status", "code"),
    [
        ("global", 503, "DECODE_CAPACITY_EXCEEDED"),
        ("session", 429, "FRAME_UPLOAD_IN_PROGRESS"),
        ("memory", 503, "IMAGE_BUFFER_CAPACITY_EXCEEDED"),
    ],
)
async def test_frame_admission_rejects_before_reading_body(
    api_client, multipart_frame, monkeypatch, capacity, status, code
) -> None:
    app, client = api_client
    manager = app.state.sessions
    manager.settings.max_concurrent_decodes = 1 if capacity == "global" else 2
    reserved_bytes = manager.settings.max_image_bytes + manager.settings.max_image_pixels * 16
    if capacity == "memory":
        manager.settings.max_buffered_image_bytes = reserved_bytes
    first_id = (await client.post("/api/v1/vision/sessions", json={})).json()["session_id"]
    second_id = (await client.post("/api/v1/vision/sessions", json={})).json()["session_id"]
    entered = asyncio.Event()
    release = asyncio.Event()
    body, headers = multipart_frame
    decode = Mock(wraps=api_module.decode_image)
    monkeypatch.setattr(api_module, "decode_image", decode)

    async def first_body():
        entered.set()
        await release.wait()
        yield body

    uploading = asyncio.create_task(
        client.post(f"/api/v1/vision/sessions/{first_id}/frames", headers=headers, content=first_body())
    )
    read_rejected_body = Mock()

    async def rejected_body():
        read_rejected_body()
        yield body

    try:
        await asyncio.wait_for(entered.wait(), timeout=2)
        assert len(manager._uploads) == 1
        assert manager._buffered_image_bytes == reserved_bytes
        target = first_id if capacity == "session" else second_id

        response = await client.post(
            f"/api/v1/vision/sessions/{target}/frames", headers=headers, content=rejected_body()
        )

        assert response.status_code == status
        assert response.json()["error"]["code"] == code
        assert response.headers["Retry-After"] == "1"
        read_rejected_body.assert_not_called()
        decode.assert_not_called()
        assert len(manager._uploads) == 1
        assert manager._buffered_image_bytes == reserved_bytes
    finally:
        release.set()
        first_response = await asyncio.wait_for(uploading, timeout=3)

    assert first_response.status_code == 202
    await asyncio.wait_for(manager.get(first_id).queue.join(), timeout=2)
    assert manager._uploads == []
    assert manager._buffered_image_bytes == 0
    assert not manager.get(first_id).uploading
    assert not manager.get(second_id).uploading


async def test_frame_rate_rejection_does_not_read_or_decode(api_client, jpeg_bytes, monkeypatch) -> None:
    app, client = api_client
    app.state.settings.max_frame_rate = 0.001
    decode = Mock(wraps=api_module.decode_image)
    monkeypatch.setattr(api_module, "decode_image", decode)
    session_id = (await client.post("/api/v1/vision/sessions", json={})).json()["session_id"]
    path = f"/api/v1/vision/sessions/{session_id}/frames"
    first = await client.post(
        path, data={"frame_id": "first"}, files={"frame": ("frame.jpg", jpeg_bytes, "image/jpeg")}
    )
    assert first.status_code == 202
    session = app.state.sessions.get(session_id)
    await asyncio.wait_for(session.queue.join(), timeout=2)
    read_body = Mock()

    async def body():
        read_body()
        yield b"must not decode"

    response = await client.post(
        path, headers={"Content-Type": "multipart/form-data; boundary=test"}, content=body()
    )

    assert response.status_code == 429
    assert response.json()["error"]["code"] == "FRAME_RATE_EXCEEDED"
    read_body.assert_not_called()
    assert decode.call_count == 1
    assert session.stats.accepted_frames == 1
    assert session.pending_frame_ids == set()
    assert app.state.sessions._uploads == []
    assert app.state.sessions._buffered_image_bytes == 0


@pytest.mark.parametrize(
    ("length", "status", "code"),
    [
        ("oversize", 413, "IMAGE_TOO_LARGE"),
        ("-1", 413, "IMAGE_TOO_LARGE"),
        ("invalid", 422, "INVALID_CONTENT_LENGTH"),
    ],
)
async def test_invalid_content_length_rejects_without_reading_and_releases_reservation(
    api_client, monkeypatch, length, status, code
) -> None:
    app, client = api_client
    manager = app.state.sessions
    session_id = (await client.post("/api/v1/vision/sessions", json={})).json()["session_id"]
    if length == "oversize":
        length = str(manager.settings.max_image_bytes + 64 * 1024 + 1)
    read_body = Mock()
    decode = Mock(side_effect=AssertionError("invalid length reached decode"))
    monkeypatch.setattr(api_module, "decode_image", decode)

    async def body():
        read_body()
        yield b"must not read"

    response = await client.post(
        f"/api/v1/vision/sessions/{session_id}/frames",
        headers={"Content-Type": "multipart/form-data; boundary=test", "Content-Length": length},
        content=body(),
    )

    assert response.status_code == status
    assert response.json()["error"]["code"] == code
    read_body.assert_not_called()
    decode.assert_not_called()
    assert manager._uploads == []
    assert manager._buffered_image_bytes == 0
    assert not manager.get(session_id).uploading
    assert manager.metrics.registry.get_sample_value("bird_vision_buffered_image_bytes") == 0


@pytest.mark.parametrize("declared_length", [None, "1"], ids=["chunked", "understated-length"])
async def test_streamed_multipart_limit_stops_reading_and_releases_reservation(
    api_client, monkeypatch, declared_length
) -> None:
    app, client = api_client
    manager = app.state.sessions
    manager.settings.max_image_bytes = 1024
    session_id = (await client.post("/api/v1/vision/sessions", json={})).json()["session_id"]
    headers = {"Content-Type": "multipart/form-data; boundary=test"}
    if declared_length is not None:
        headers["Content-Length"] = declared_length
    read_chunks = []
    decode = Mock(side_effect=AssertionError("oversize multipart reached decode"))
    monkeypatch.setattr(api_module, "decode_image", decode)

    async def body():
        chunks = (
            b'--test\r\nContent-Disposition: form-data; name="frame"; filename="frame.jpg"\r\n'
            b"Content-Type: image/jpeg\r\n\r\n",
            b"x" * (manager.settings.max_image_bytes + 64 * 1024),
            b"\r\n--test--\r\n",
        )
        for index, chunk in enumerate(chunks):
            read_chunks.append(index)
            yield chunk

    response = await client.post(
        f"/api/v1/vision/sessions/{session_id}/frames", headers=headers, content=body()
    )

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "IMAGE_TOO_LARGE"
    assert read_chunks == [0, 1]
    decode.assert_not_called()
    assert manager._uploads == []
    assert manager._buffered_image_bytes == 0
    assert not manager.get(session_id).uploading


@pytest.mark.parametrize(
    ("payload", "status", "code"),
    [
        (b"not an image", 422, "IMAGE_DECODE_FAILED"),
        (b"", 422, "EMPTY_IMAGE"),
        (b"x" * 4097, 413, "IMAGE_TOO_LARGE"),
    ],
)
async def test_decode_failure_releases_budget_and_frame_id_for_retry(
    api_client, jpeg_bytes, payload, status, code
) -> None:
    app, client = api_client
    manager = app.state.sessions
    manager.settings.max_image_bytes = 4096
    session_id = (await client.post("/api/v1/vision/sessions", json={})).json()["session_id"]
    path = f"/api/v1/vision/sessions/{session_id}/frames"

    response = await client.post(
        path, data={"frame_id": "retry"}, files={"frame": ("frame.jpg", payload, "image/jpeg")}
    )

    assert response.status_code == status
    assert response.json()["error"]["code"] == code
    session = manager.get(session_id)
    assert session.pending_frame_ids == set()
    assert session.seen_frame_ids == set()
    assert session.stats.accepted_frames == 0
    assert not session.uploading
    assert manager._uploads == []
    assert manager._buffered_image_bytes == 0
    assert manager.metrics.registry.get_sample_value("bird_vision_buffered_image_bytes") == 0

    session.last_accepted_monotonic = None
    retry = await client.post(
        path, data={"frame_id": "retry"}, files={"frame": ("frame.jpg", jpeg_bytes, "image/jpeg")}
    )
    assert retry.status_code == 202
    await asyncio.wait_for(session.queue.join(), timeout=2)
    assert session.seen_frame_ids == {"retry"}
    assert session.stats.accepted_frames == 1
    assert manager._buffered_image_bytes == 0


async def test_upload_timeout_releases_admission_and_budget(api_client, monkeypatch) -> None:
    app, client = api_client
    manager = app.state.sessions
    manager.settings.upload_timeout_seconds = 0.02
    session_id = (await client.post("/api/v1/vision/sessions", json={})).json()["session_id"]
    waiting = asyncio.Event()
    cancelled = asyncio.Event()
    never = asyncio.Event()
    decode = Mock(side_effect=AssertionError("timed-out upload reached decode"))
    monkeypatch.setattr(api_module, "decode_image", decode)

    async def body():
        waiting.set()
        try:
            await never.wait()
            yield b"unreachable"
        finally:
            cancelled.set()

    response = await asyncio.wait_for(
        client.post(
            f"/api/v1/vision/sessions/{session_id}/frames",
            headers={"Content-Type": "multipart/form-data; boundary=test"},
            content=body(),
        ),
        timeout=2,
    )

    assert response.status_code == 408
    assert response.json()["error"]["code"] == "UPLOAD_TIMEOUT"
    assert waiting.is_set()
    assert cancelled.is_set()
    decode.assert_not_called()
    assert manager._uploads == []
    assert manager._buffered_image_bytes == 0
    assert not manager.get(session_id).uploading


@pytest.mark.parametrize("with_middleware", [False, True], ids=["route", "app"])
async def test_cancelled_decode_keeps_admission_until_native_thread_finishes(
    api_client, jpeg_bytes, monkeypatch, with_middleware
) -> None:
    app, client = api_client
    manager = app.state.sessions
    session_id = (await client.post("/api/v1/vision/sessions", json={})).json()["session_id"]
    session = manager.get(session_id)
    entered = asyncio.Event()
    finished = asyncio.Event()
    release = Event()
    image = Image.new("RGB", (32, 32))
    loop = asyncio.get_running_loop()

    def decode(*args):
        loop.call_soon_threadsafe(entered.set)
        try:
            assert release.wait(timeout=5), "test did not release Pillow decode"
            return image, 1.0
        finally:
            loop.call_soon_threadsafe(finished.set)

    monkeypatch.setattr(api_module, "decode_image", decode)
    frame_app = app
    if not with_middleware:
        frame_app = FastAPI()
        frame_app.include_router(api_module.router)
        frame_app.state = app.state
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=frame_app), base_url="http://test"
    ) as frame_client:
        uploading = asyncio.create_task(
            frame_client.post(
                f"/api/v1/vision/sessions/{session_id}/frames",
                data={"frame_id": "cancelled"},
                files={"frame": ("frame.jpg", jpeg_bytes, "image/jpeg")},
            )
        )
        try:
            await asyncio.wait_for(entered.wait(), timeout=2)
            uploading.cancel()
            cancellation_delivered = asyncio.Event()
            loop.call_soon(cancellation_delivered.set)
            await cancellation_delivered.wait()

            assert not uploading.done()
            assert not finished.is_set()
            assert session.uploading
            assert session.pending_frame_ids == {"cancelled"}
            assert len(manager._uploads) == 1
            assert manager._buffered_image_bytes == manager._uploads[0].reserved_bytes > 0
            assert image.getpixel((0, 0)) == (0, 0, 0)
        finally:
            release.set()
            await asyncio.wait_for(asyncio.gather(uploading, return_exceptions=True), timeout=3)
            if entered.is_set():
                await asyncio.wait_for(finished.wait(), timeout=3)

    assert uploading.cancelled()
    assert finished.is_set()
    assert session.pending_frame_ids == set()
    assert session.seen_frame_ids == set()
    assert not session.uploading
    assert manager._uploads == []
    assert manager._buffered_image_bytes == 0
    with pytest.raises(ValueError, match="closed image"):
        image.getpixel((0, 0))


async def test_shutdown_waits_for_multipart_upload_before_closing_session(
    api_client, multipart_frame
) -> None:
    app, client = api_client
    manager = app.state.sessions
    session_id = (await client.post("/api/v1/vision/sessions", json={})).json()["session_id"]
    session = manager.get(session_id)
    entered = asyncio.Event()
    release = asyncio.Event()
    body, headers = multipart_frame

    async def uploading_body():
        entered.set()
        await release.wait()
        yield body

    uploading = asyncio.create_task(
        client.post(f"/api/v1/vision/sessions/{session_id}/frames", headers=headers, content=uploading_body())
    )
    stopping = None
    try:
        await asyncio.wait_for(entered.wait(), timeout=2)
        stopping = asyncio.create_task(manager.stop())
        stop_started = asyncio.Event()
        asyncio.get_running_loop().call_soon(stop_started.set)
        await stop_started.wait()

        assert manager._closing
        assert not stopping.done()
        assert not uploading.done()
        assert session.state == "active"
        assert session.uploading
        assert manager._buffered_image_bytes > 0
    finally:
        release.set()
        response = await asyncio.wait_for(uploading, timeout=3)
        if stopping is not None:
            await asyncio.wait_for(stopping, timeout=3)

    assert response.status_code == 202
    assert session.state == "closed"
    assert not session.uploading
    assert manager.sessions == {}
    assert manager._uploads == []
    assert manager._buffered_image_bytes == 0


def test_websocket_subscriber_quota_is_reusable_after_disconnect(test_settings) -> None:
    test_settings.max_subscribers_per_session = 1
    with TestClient(create_app(test_settings)) as client:
        session_id = client.post("/api/v1/vision/sessions", json={}).json()["session_id"]
        path = f"/api/v1/vision/sessions/{session_id}/events"
        with client.websocket_connect(path) as first:
            assert first.receive_json()["type"] == "vision.session.started"
            with pytest.raises(WebSocketDisconnect) as denied, client.websocket_connect(path):
                pass
            assert denied.value.code == 4429
            assert denied.value.reason == "SUBSCRIBER_CAPACITY_EXCEEDED"

        with client.websocket_connect(path) as replacement:
            assert replacement.receive_json()["type"] == "vision.session.started"
            assert client.delete(f"/api/v1/vision/sessions/{session_id}").status_code == 204
            assert replacement.receive_json()["type"] == "vision.session.closed"
        assert "bird_vision_websocket_subscribers 0.0" in client.get("/metrics").text
