from __future__ import annotations

from fastapi.testclient import TestClient

from bird_vision.app import create_app
from bird_vision.config import Settings
from bird_vision.domain import Box, DetectorOutput, RawDetection, SpeciesCandidate, SpeciesPrediction


def photo_settings(**overrides) -> Settings:
    base = dict(
        environment="test",
        detector_backend="mock",
        species_backend="mock",
        device="cpu",
        allow_anonymous=True,
        min_recognizable_side_px=32,
        photo_max_subjects=2,
    )
    base.update(overrides)
    return Settings(**base)


def upload(client: TestClient, data: bytes, content_type: str = "image/jpeg", name: str = "bird.jpg"):
    return client.post("/api/v1/vision/analyses", files={"image": (name, data, content_type)})


def test_photo_analysis_returns_candidates_and_subject(jpeg_bytes) -> None:
    with TestClient(create_app(photo_settings())) as client:
        response = upload(client, jpeg_bytes)
    assert response.status_code == 200
    body = response.json()
    assert body["analysis_id"].startswith("pho_")
    assert body["state"] == "candidate"
    assert body["candidates"][0]["species_id"] == "mock_bird"
    assert body["candidates"][0]["score_type"] == "mock"
    assert body["subjects"][0]["state"] == "candidate"
    assert 0.0 <= body["subjects"][0]["bbox"]["x1"] <= 1.0
    assert body["subjects"][0]["short_side_px"] > 32
    assert body["image"]["width"] == 320 and body["image"]["height"] == 240
    assert body["image"]["size_bytes"] == len(jpeg_bytes)
    assert body["policy"]["decision"] == "candidate"
    assert body["policy"]["reason"] == "candidate_above_similarity"
    assert body["policy"]["max_subjects"] == 2
    assert body["model"]["name"] == "mock-species-classifier"
    assert body["timing"]["total_ms"] >= 0.0


def test_photo_analysis_without_classifier(jpeg_bytes) -> None:
    settings = photo_settings(species_backend="disabled")
    with TestClient(create_app(settings)) as client:
        response = upload(client, jpeg_bytes)
    body = response.json()
    assert response.status_code == 200
    assert body["state"] == "unknown"
    assert body["candidates"] == []
    assert body["policy"]["reason"] == "species_backend_disabled"
    assert "classifier_disabled" in body["notes"]
    assert body["subjects"][0]["state"] == "unknown"


def test_photo_analysis_without_detections(jpeg_bytes) -> None:
    app = create_app(photo_settings())
    with TestClient(app) as client:
        client.app.state.detector.predict = lambda image: DetectorOutput(())
        response = upload(client, jpeg_bytes)
    body = response.json()
    assert body["state"] == "unknown"
    assert body["policy"]["reason"] == "no_bird_detected"
    assert body["subjects"] == []


def test_photo_analysis_ignores_tiny_subjects(jpeg_bytes) -> None:
    app = create_app(photo_settings())
    with TestClient(app) as client:
        client.app.state.detector.predict = lambda image: DetectorOutput(
            (RawDetection(box=Box(10, 10, 30, 30), score=0.9),)
        )
        response = upload(client, jpeg_bytes)
    body = response.json()
    assert body["state"] == "unknown"
    assert body["policy"]["reason"] == "subject_below_minimum_size"
    assert "small_detections_ignored" in body["notes"]


def test_photo_analysis_reports_rejected_prediction(jpeg_bytes) -> None:
    app = create_app(photo_settings())
    with TestClient(app) as client:

        def rejected(images, top_k, region_code=None, context=None):
            candidate = SpeciesCandidate(
                species_id="x",
                scientific_name="Avis exemplum",
                common_name_zh=None,
                common_name_en=None,
                score=0.31,
                score_type="mock",
            )
            return [
                SpeciesPrediction(
                    candidates=(candidate,),
                    accepted=False,
                    reason="below_min_similarity",
                    top_similarity=0.31,
                    margin=0.02,
                    candidate_count=1,
                    region_code=None,
                    catalog_version="mock",
                )
                for _ in images
            ]

        client.app.state.species.classify = rejected
        response = upload(client, jpeg_bytes)
    body = response.json()
    assert body["state"] == "unknown"
    assert body["policy"]["reason"] == "below_min_similarity"
    assert body["candidates"] == []


def test_photo_analysis_rejects_unsupported_media() -> None:
    with TestClient(create_app(photo_settings())) as client:
        unsupported = upload(client, b"not an image", content_type="image/gif")
        corrupt = upload(client, b"not an image", content_type="image/jpeg")
    assert unsupported.status_code == 415
    assert unsupported.json()["error"]["code"] == "UNSUPPORTED_IMAGE_TYPE"
    assert corrupt.status_code == 422
    assert corrupt.json()["error"]["code"] == "IMAGE_DECODE_FAILED"


def test_photo_analysis_enforces_byte_limit(jpeg_bytes) -> None:
    settings = photo_settings(max_image_bytes=1024)
    with TestClient(create_app(settings)) as client:
        response = upload(client, jpeg_bytes)
    assert response.status_code in {413, 422}
    assert response.json()["error"]["code"] in {"IMAGE_TOO_LARGE", "IMAGE_DIMENSIONS_INVALID"}


def test_photo_analysis_requires_authentication(jpeg_bytes) -> None:
    settings = photo_settings(allow_anonymous=False, api_keys="secret")
    with TestClient(create_app(settings)) as client:
        anonymous = upload(client, jpeg_bytes)
        authorized = client.post(
            "/api/v1/vision/analyses",
            files={"image": ("bird.jpg", jpeg_bytes, "image/jpeg")},
            headers={"Authorization": "Bearer secret"},
        )
    assert anonymous.status_code == 401
    assert authorized.status_code == 200


def test_photo_endpoint_is_documented() -> None:
    with TestClient(create_app(photo_settings())) as client:
        schema = client.get("/openapi.json").json()
    post = schema["paths"]["/api/v1/vision/analyses"]["post"]
    assert post["requestBody"]["content"]["multipart/form-data"]
    assert "415" in post["responses"]
