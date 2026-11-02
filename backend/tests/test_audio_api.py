from __future__ import annotations

import array

import httpx
import pytest

from bird_audio.app import create_app
from bird_audio.audio import AudioDecoder
from bird_audio.config import AudioSettings


class FakeRunner:
    """Stand-in for ffmpeg: returns raw 48 kHz float32 PCM."""

    def __init__(self, duration_seconds: float = 6.0) -> None:
        self.stdout = array.array("f", [0.2] * int(duration_seconds * 48_000)).tobytes()
        self.calls = 0

    def __call__(self, args, timeout):  # noqa: ANN001 - test double
        self.calls += 1
        stderr = b"  Stream #0:0: Audio: mp3, 44100 Hz, mono, fltp, 96 kb/s\n"
        return 0, self.stdout, stderr


# Real frame header after a zero-length ID3v2 tag: MP3 layer III (0xFFFB).
MP3_BYTES = b"ID3\x04\x00\x00\x00\x00\x00\x00" + b"\xff\xfb\x90\x00" + bytes(512)
# ADTS AAC, MPEG-4 without CRC and with CRC (0xFFF0), plus an MP4/M4A container.
ADTS_BYTES = b"\xff\xf1\x50\x80" + bytes(512)
ADTS_CRC_BYTES = b"\xff\xf0\x50\x80" + bytes(512)
M4A_BYTES = b"\x00\x00\x00\x20ftypM4A \x00\x00\x00\x00" + bytes(512)


def make_client(settings: AudioSettings, *, duration_seconds: float = 6.0):
    decoder = AudioDecoder(settings, runner=FakeRunner(duration_seconds), ffmpeg="ffmpeg")
    return create_app(settings, decoder=decoder)


@pytest.fixture
async def audio_api(audio_settings):
    app = make_client(audio_settings)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client,
    ):
        yield app, client


def audio_file(data: bytes = MP3_BYTES, *, content_type: str = "audio/mpeg"):
    return {"audio": ("voice.mp3", data, content_type)}


async def test_health_and_readiness(audio_api) -> None:
    app, client = audio_api
    health = await client.get("/healthz")
    assert health.status_code == 200
    assert health.json()["service"] == "bird-audio-service"
    ready = await client.get("/readyz")
    assert ready.status_code == 200
    body = ready.json()
    assert body["status"] == "ready"
    assert {model["name"] for model in body["models"]} >= {"mock-birdnet", "audio-analysis-runtime"}
    assert body["models"][1]["details"]["labels"]["source"] in {"builtin_mock", "model_file"}
    assert app.state.ffmpeg_path


async def test_models_endpoint_reports_versions_and_policy(audio_api) -> None:
    _, client = audio_api
    response = await client.get("/api/v1/models")
    assert response.status_code == 200
    body = response.json()
    assert body["models"][0]["name"] == "mock-birdnet"
    assert body["models"][0]["details"]["version"] == "2.4"
    assert body["labels"]["count"] >= 5
    assert body["policy"]["min_score"] == pytest.approx(0.5)
    assert body["policy"]["score_type"] == "mock"
    assert body["formats"]["accepted"] == ["mp3", "wav", "aac", "m4a"]
    assert "audio/aacp" in body["formats"]["content_types"]
    assert body["formats"]["max_bytes"] == 10 * 1024 * 1024


async def test_analysis_returns_ranked_candidates(audio_api) -> None:
    _, client = audio_api
    response = await client.post(
        "/api/v1/audio/analyses",
        files=audio_file(),
        data={"top_k": "3", "client_reference": "wx-recording-1"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["state"] == "candidate"
    assert body["analysis_id"].startswith("aud_")
    assert body["client_reference"] == "wx-recording-1"
    assert body["candidates"][0]["rank"] == 1
    assert body["candidates"][0]["score_type"] == "mock"
    assert body["audio"]["format"] == "mp3"
    assert body["audio"]["size_bytes"] == len(MP3_BYTES)
    assert body["audio"]["duration_seconds"] == pytest.approx(6.0)
    assert body["audio"]["window_count"] == 3
    assert body["policy"]["required_windows"] == 2
    assert body["policy"]["decision"] == "candidate"
    assert "mock_engine" in body["notes"]
    assert body["timing"]["total_ms"] >= 0.0
    assert body["diagnostics"]["windows"][0]["index"] == 0
    assert set(body["model"]) >= {"name", "backend", "device", "ready", "score_type", "details"}


async def test_candidate_count_is_configurable(audio_settings) -> None:
    settings = audio_settings.model_copy(update={"max_candidate_count": 2, "candidate_count": 2})
    app = make_client(settings)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client,
    ):
        response = await client.post("/api/v1/audio/analyses", files=audio_file())
        assert response.status_code == 200
        assert len(response.json()["candidates"]) <= 2
        rejected = await client.post("/api/v1/audio/analyses", files=audio_file(), data={"top_k": "3"})
        assert rejected.status_code == 422
        assert rejected.json()["error"]["code"] == "INVALID_CANDIDATE_COUNT"


async def test_short_recording_policy_notes(audio_settings) -> None:
    app = make_client(audio_settings, duration_seconds=2.0)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client,
    ):
        response = await client.post("/api/v1/audio/analyses", files=audio_file())
    body = response.json()
    assert body["audio"]["window_count"] == 1
    assert body["audio"]["zero_padded_seconds"] == pytest.approx(1.0)
    assert body["policy"]["required_windows"] == 1
    assert "short_clip_zero_padded" in body["notes"]


async def test_empty_upload_is_rejected(audio_api) -> None:
    _, client = audio_api
    response = await client.post("/api/v1/audio/analyses", files=audio_file(b""))
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "EMPTY_AUDIO"


async def test_unsupported_content_type_is_rejected(audio_api) -> None:
    _, client = audio_api
    response = await client.post("/api/v1/audio/analyses", files=audio_file(content_type="audio/amr"))
    assert response.status_code == 415
    assert response.json()["error"]["code"] == "UNSUPPORTED_AUDIO_TYPE"


async def test_content_type_mismatch_is_rejected(audio_api) -> None:
    _, client = audio_api
    response = await client.post(
        "/api/v1/audio/analyses",
        files={"audio": ("voice.wav", MP3_BYTES, "audio/wav")},
    )
    assert response.status_code == 415
    body = response.json()["error"]
    assert body["code"] == "AUDIO_FORMAT_MISMATCH"
    assert body["details"]["detected_format"] == "mp3"


@pytest.mark.parametrize(
    "content_type",
    ["audio/aac", "audio/x-aac", "audio/aacp", "audio/adts", "audio/x-hx-aac-adts", "audio/mp4a-latm"],
)
async def test_adts_aac_is_accepted_for_every_alias(audio_api, content_type: str) -> None:
    _, client = audio_api
    response = await client.post(
        "/api/v1/audio/analyses",
        files={"audio": ("voice.aac", ADTS_BYTES, content_type)},
    )
    assert response.status_code == 200
    assert response.json()["audio"]["format"] == "aac"


async def test_crc_protected_adts_is_accepted(audio_api) -> None:
    """CRC-present ADTS (0xFFF0) used to be misread as MP3 and rejected."""
    _, client = audio_api
    response = await client.post(
        "/api/v1/audio/analyses",
        files={"audio": ("voice.aac", ADTS_CRC_BYTES, "audio/aac")},
    )
    assert response.status_code == 200
    assert response.json()["audio"]["format"] == "aac"


@pytest.mark.parametrize(
    ("content_type", "expected_format"),
    [
        ("audio/aac", "m4a"),
        ("audio/mp4", "m4a"),
        ("audio/x-m4a", "m4a"),
        ("video/mp4", "m4a"),
        ("audio/3gpp", "m4a"),
    ],
)
async def test_mp4_container_aac_is_accepted(audio_api, content_type: str, expected_format: str) -> None:
    """iOS records AAC into an MP4 container, usually declared as audio/aac."""
    _, client = audio_api
    response = await client.post(
        "/api/v1/audio/analyses",
        files={"audio": ("voice.m4a", M4A_BYTES, content_type)},
    )
    assert response.status_code == 200
    assert response.json()["audio"]["format"] == expected_format


async def test_oversized_upload_is_rejected_before_inference(audio_settings) -> None:
    settings = audio_settings.model_copy(update={"max_audio_bytes": 2048})
    runner = FakeRunner()
    decoder = AudioDecoder(settings, runner=runner, ffmpeg="ffmpeg")
    app = create_app(settings, decoder=decoder)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client,
    ):
        response = await client.post("/api/v1/audio/analyses", files=audio_file(b"ID3\x04" + b"x" * 8192))
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "AUDIO_TOO_LARGE"
    assert runner.calls == 0


async def test_missing_file_field_is_a_validation_error(audio_api) -> None:
    _, client = audio_api
    response = await client.post("/api/v1/audio/analyses", data={"top_k": "3"})
    assert response.status_code == 422
    body = response.json()["error"]
    assert body["code"] == "VALIDATION_ERROR"
    assert any(part == "audio" for part in body["details"][0]["loc"])


async def test_authentication_is_enforced() -> None:
    settings = AudioSettings(
        environment="test", engine_backend="mock", allow_anonymous=False, api_keys="secret-key"
    )
    app = make_client(settings)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client,
    ):
        anonymous = await client.post("/api/v1/audio/analyses", files=audio_file())
        assert anonymous.status_code == 401
        assert anonymous.json()["error"]["code"] == "AUTH_REQUIRED"
        authorized = await client.post(
            "/api/v1/audio/analyses", files=audio_file(), headers={"X-API-Key": "secret-key"}
        )
        assert authorized.status_code == 200
        wrong = await client.get("/api/v1/models", headers={"X-API-Key": "nope"})
        assert wrong.status_code == 401
        assert wrong.json()["error"]["code"] == "AUTH_INVALID"


async def test_request_id_is_echoed(audio_api) -> None:
    _, client = audio_api
    response = await client.get("/healthz", headers={"X-Request-ID": "wx-request-42"})
    assert response.headers["X-Request-ID"] == "wx-request-42"


async def test_metrics_endpoint(audio_api) -> None:
    _, client = audio_api
    await client.post("/api/v1/audio/analyses", files=audio_file())
    response = await client.get("/metrics")
    assert response.status_code == 200
    assert "bird_audio_analyses_total" in response.text


async def test_openapi_documents_the_analysis_endpoint(audio_api) -> None:
    _, client = audio_api
    schema = (await client.get("/openapi.json")).json()
    post = schema["paths"]["/api/v1/audio/analyses"]["post"]
    assert post["requestBody"]["content"]["multipart/form-data"]
    assert "415" in post["responses"]
    assert "413" in post["responses"]
    assert schema["info"]["title"] == "Bird Assistant Audio API"


async def test_response_without_diagnostics_when_disabled(audio_settings) -> None:
    settings = audio_settings.model_copy(update={"include_diagnostics": False})
    app = make_client(settings)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client,
    ):
        response = await client.post("/api/v1/audio/analyses", files=audio_file())
    assert response.json()["diagnostics"] is None
