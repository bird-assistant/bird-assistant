from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from bird_business.app import create_app
from bird_business.config import BusinessSettings
from bird_business.db import ObservationStore
from bird_common.errors import ServiceError

PAYLOAD = {
    "source": "audio",
    "source_analysis_id": "aud_abc",
    "species_id": "avibase-F2858F9F",
    "scientific_name": "Turdus merula",
    "common_name_zh": "乌鸫",
    "common_name_en": "Eurasian Blackbird",
    "score": 0.93,
    "score_type": "birdnet_confidence",
    "client_reference": "wx-1",
}


def test_store_roundtrip_and_idempotency(business_settings) -> None:
    store = ObservationStore(business_settings)
    try:
        observation, created = store.create(
            owner_subject="owner",
            observation_id="obs_1",
            observed_at=datetime.now(UTC),
            source="audio",
            source_analysis_id="aud_abc",
            species_id="avibase-1",
            scientific_name="Turdus merula",
            common_name_zh="乌鸫",
            common_name_en="Eurasian Blackbird",
            score=0.9,
            score_type="birdnet_confidence",
            latitude=None,
            longitude=None,
            region_code=None,
            note=None,
            client_reference="wx-1",
        )
        assert created is True
        assert observation.observation_id == "obs_1"
        again, created_again = store.create(
            owner_subject="owner",
            observation_id="obs_2",
            observed_at=datetime.now(UTC),
            source="audio",
            source_analysis_id="aud_abc",
            species_id="avibase-1",
            scientific_name="Turdus merula",
            common_name_zh="乌鸫",
            common_name_en="Eurasian Blackbird",
            score=0.9,
            score_type="birdnet_confidence",
            latitude=None,
            longitude=None,
            region_code=None,
            note=None,
            client_reference="wx-1",
        )
        assert created_again is False
        assert again.observation_id == "obs_1"
        assert store.count() == 1
        assert store.get("obs_1", "owner").species_id == "avibase-1"
        with pytest.raises(ServiceError) as excinfo:
            store.get("obs_1", "someone-else")
        assert excinfo.value.code == "OBSERVATION_NOT_FOUND"
    finally:
        store.close()


def test_store_list_filters_and_paginates(business_settings) -> None:
    store = ObservationStore(business_settings)
    try:
        for index, source in enumerate(["audio", "photo", "audio"]):
            store.create(
                owner_subject="owner",
                observation_id=f"obs_{index}",
                observed_at=datetime.now(UTC) - timedelta(minutes=index),
                source=source,
                source_analysis_id=f"ana_{index}",
                species_id=f"sp_{index}",
                scientific_name="Avis exemplum",
                common_name_zh=None,
                common_name_en=None,
                score=None,
                score_type=None,
                latitude=None,
                longitude=None,
                region_code=None,
                note=None,
                client_reference=None,
            )
        store.create(
            owner_subject="other",
            observation_id="obs_other",
            observed_at=datetime.now(UTC),
            source="audio",
            source_analysis_id="ana_x",
            species_id="sp_x",
            scientific_name="Avis exemplum",
            common_name_zh=None,
            common_name_en=None,
            score=None,
            score_type=None,
            latitude=None,
            longitude=None,
            region_code=None,
            note=None,
            client_reference=None,
        )
        total, items = store.list(owner_subject="owner", limit=2, offset=0)
        assert total == 3
        assert len(items) == 2
        audio_total, audio_items = store.list(owner_subject="owner", limit=10, offset=0, source="audio")
        assert audio_total == 2
        assert all(item.source == "audio" for item in audio_items)
        assert store.count("other") == 1
    finally:
        store.close()


def test_store_delete(business_settings) -> None:
    store = ObservationStore(business_settings)
    try:
        store.create(
            owner_subject="owner",
            observation_id="obs_1",
            observed_at=datetime.now(UTC),
            source="photo",
            source_analysis_id="pho_1",
            species_id="sp",
            scientific_name="Avis exemplum",
            common_name_zh=None,
            common_name_en=None,
            score=None,
            score_type=None,
            latitude=None,
            longitude=None,
            region_code=None,
            note=None,
            client_reference=None,
        )
        store.delete("obs_1", "owner")
        assert store.count() == 0
        with pytest.raises(ServiceError):
            store.delete("obs_1", "owner")
    finally:
        store.close()


def business_client(settings: BusinessSettings) -> TestClient:
    return TestClient(create_app(settings))


def test_api_creates_and_retries_observations(business_settings) -> None:
    with business_client(business_settings) as client:
        created = client.post("/api/v1/observations", json=PAYLOAD)
        assert created.status_code == 201
        body = created.json()
        assert body["observation_id"].startswith("obs_")
        assert body["source"] == "audio"
        assert body["score"] == pytest.approx(0.93)
        retry = client.post("/api/v1/observations", json=PAYLOAD)
        assert retry.status_code == 200
        assert retry.json()["observation_id"] == body["observation_id"]
        fetched = client.get(f"/api/v1/observations/{body['observation_id']}")
        assert fetched.status_code == 200
        page = client.get("/api/v1/observations").json()
        assert page["total"] == 1
        assert page["items"][0]["observation_id"] == body["observation_id"]
        filtered = client.get("/api/v1/observations", params={"source": "photo"}).json()
        assert filtered["total"] == 0
        deleted = client.delete(f"/api/v1/observations/{body['observation_id']}")
        assert deleted.status_code == 204
        missing = client.get(f"/api/v1/observations/{body['observation_id']}")
        assert missing.status_code == 404


def test_api_validates_payload(business_settings) -> None:
    with business_client(business_settings) as client:
        assert client.post("/api/v1/observations", json={**PAYLOAD, "source": "video"}).status_code == 422
        partial = client.post(
            "/api/v1/observations", json={**PAYLOAD, "source_analysis_id": "aud_x", "latitude": 31.8}
        )
        assert partial.status_code == 422
        assert partial.json()["error"]["code"] == "VALIDATION_ERROR"
        paged = client.get("/api/v1/observations", params={"limit": 500})
        assert paged.status_code == 422
        assert paged.json()["error"]["code"] == "INVALID_PAGE_SIZE"
        long_note = client.post(
            "/api/v1/observations",
            json={**PAYLOAD, "source_analysis_id": "aud_y", "note": "x" * 3000},
        )
        assert long_note.status_code == 422
        assert long_note.json()["error"]["code"] == "NOTE_TOO_LONG"


def test_api_enforces_owner_isolation(business_settings) -> None:
    settings = business_settings.model_copy(update={"allow_anonymous": False, "api_keys": "key-one,key-two"})
    with business_client(settings) as client:
        created = client.post("/api/v1/observations", json=PAYLOAD, headers={"X-API-Key": "key-one"})
        observation_id = created.json()["observation_id"]
        other = client.get(f"/api/v1/observations/{observation_id}", headers={"X-API-Key": "key-two"})
        assert other.status_code == 404
        anonymous = client.get("/api/v1/observations")
        assert anonymous.status_code == 401


def test_api_readyz_and_openapi(business_settings) -> None:
    with business_client(business_settings) as client:
        health = client.get("/healthz").json()
        assert health["service"] == "bird-business-service"
        ready = client.get("/readyz")
        assert ready.status_code == 200
        assert ready.json()["status"] == "ready"
        schema = client.get("/openapi.json").json()
        assert "/api/v1/observations" in schema["paths"]
