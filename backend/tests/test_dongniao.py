from concurrent.futures import ThreadPoolExecutor
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from bird_business.config import BusinessSettings
from bird_business.dongniao import Dongniao
from bird_business.photo_gateway import PHOTO_PATH, PhotoGateway, create_app, merge_subjects
from bird_common.errors import ServiceError


def test_rate_limit_shared_between_instances_and_windows(tmp_path, monkeypatch):
    path = tmp_path / "calls.sqlite3"
    providers = [Dongniao("test", path, []) for _ in range(2)]
    clock = Mock(return_value=100.0)
    monkeypatch.setattr("bird_business.dongniao.time.time", clock)

    def reserve(index):
        try:
            providers[index % 2].reserve()
            return True
        except ServiceError as error:
            assert error.status_code == 429
            return False

    with ThreadPoolExecutor(max_workers=8) as pool:
        assert sum(pool.map(reserve, range(70))) == 60
    with pytest.raises(ServiceError):
        Dongniao("test", path, []).reserve()
    clock.return_value = 160.0
    providers[0].reserve()


def test_upload_poll_privacy_and_coordinates(tmp_path, monkeypatch):
    vendor = Dongniao("test", tmp_path / "budget", [])
    monkeypatch.setattr("bird_business.dongniao.time.sleep", lambda _: None)
    vendor.request = Mock(
        side_effect=[
            (1000, "task"),
            (1001, "task"),
            (1000, [{"box": [160, 80, 800, 400], "list": [[87.2, "鸟|Bird|Avis example", 123, "B"]]}]),
        ]
    )
    with Image.new("RGB", (3200, 1600)) as photo:
        photo.info["exif"] = b"private-location"
        (result,) = vendor.identify(photo)
    upload, poll, again = vendor.request.call_args_list
    assert b"private-location" not in upload.args[0]
    assert poll.args[0] == again.args[0] == b"resultid=task"
    assert result["bbox"] == dict(x1=0.1, y1=0.1, x2=0.5, y2=0.5)
    assert result["candidates"][0]["score"] == pytest.approx(0.872)
    assert result["candidates"][0]["species_id"] is None


@pytest.mark.parametrize(
    "reason", ["gpu_busy", "gpu_unavailable", "ambiguous_candidates", "below_similarity_threshold"]
)
def test_triggers_and_preserves_local_result_on_vendor_error(reason, jpeg_bytes):
    vendor = Mock()
    gateway = PhotoGateway(vendor)
    local = (
        None
        if reason.startswith("gpu_")
        else dict(
            model={"device": "cuda:0"},
            subjects=[{"state": "unknown", "reason": reason}],
            policy={"reason": reason},
            notes=[],
        )
    )
    gateway.primary = Mock(return_value=(local, reason if local is None else None))
    vendor.identify.side_effect = ServiceError("PHOTO_REVIEW_BUSY", "rate limit", 429)
    if local is None:
        with pytest.raises(ServiceError, match="rate limit"):
            gateway.analyze(jpeg_bytes, "image/jpeg", {}, {})
    else:
        assert gateway.analyze(jpeg_bytes, "image/jpeg", {}, {}) is local
        assert local["notes"] == ["PHOTO_REVIEW_BUSY"]
    vendor.identify.assert_called_once()


def test_certain_photo_skips_vendor_and_mixed_photo_keeps_certain_bird(jpeg_bytes):
    vendor = Mock()
    gateway = PhotoGateway(vendor)
    certain = {
        "state": "candidate",
        "reason": "candidate_above_similarity",
        "bbox": dict(x1=0, y1=0, x2=0.4, y2=1),
    }
    uncertain = {"state": "unknown", "bbox": dict(x1=0.5, y1=0, x2=1, y2=1), "candidates": []}
    response = dict(subjects=[certain], model={"device": "cuda:0"}, policy={"reason": certain["reason"]})
    gateway.primary = Mock(return_value=(response, None))
    assert gateway.analyze(jpeg_bytes, "image/jpeg", {}, {}) is response
    vendor.identify.assert_not_called()
    review = {"bbox": uncertain["bbox"], "candidates": [{"species_id": "resolved"}]}
    first, second = merge_subjects([certain, uncertain], [review])
    assert first is certain
    assert second["candidates"] == review["candidates"]


def test_auth_and_bad_input_never_spend_quota(jpeg_bytes, monkeypatch):
    vendor = Mock()
    app = create_app(BusinessSettings(allow_anonymous=False, api_keys="test", _env_file=None), vendor)
    with TestClient(app) as client:
        monkeypatch.setattr(app.state.gateway, "primary", lambda *_: (None, "gpu_unavailable"))
        assert client.post(PHOTO_PATH).status_code == 401
        settings = dict(headers={"x-api-key": "test"}, files={"image": ("bird.jpg", b"bad", "image/jpeg")})
        assert client.post(PHOTO_PATH, **settings).status_code == 422
        vendor.identify.assert_not_called()
        vendor.identify.return_value = []
        settings["files"]["image"] = ("bird.jpg", jpeg_bytes, "image/jpeg")
        result = client.post(PHOTO_PATH, **settings)
        assert result.status_code == 200 and result.json()["state"] == "unknown"


def test_gpu_busy_takes_no_second_slot():
    gateway = PhotoGateway(Mock())
    with gateway.gpu_slot:
        assert gateway.primary(b"", "image/jpeg", {}, {}) == (None, "gpu_busy")
