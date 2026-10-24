from __future__ import annotations

from io import BytesIO

import pytest
from PIL import Image

from bird_vision.config import Settings


@pytest.fixture
def test_settings() -> Settings:
    return Settings(
        environment="test",
        detector_backend="mock",
        species_backend="mock",
        device="cpu",
        allow_anonymous=True,
        max_frame_rate=30.0,
        session_idle_ttl_seconds=60,
        track_confirm_hits=3,
        min_recognizable_side_px=32,
    )


@pytest.fixture
def jpeg_bytes() -> bytes:
    image = Image.new("RGB", (320, 240), (80, 120, 60))
    buffer = BytesIO()
    image.save(buffer, format="JPEG")
    return buffer.getvalue()
