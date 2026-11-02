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


# ---- audio / business service fixtures -------------------------------------


@pytest.fixture
def audio_settings(tmp_path):
    from bird_audio.config import AudioSettings

    return AudioSettings(
        environment="test",
        engine_backend="mock",
        temp_dir=tmp_path / "tmp-audio",
        min_duration_seconds=1.0,
        max_duration_seconds=60.0,
    )


@pytest.fixture
def wav_bytes():
    import io
    import math
    import struct
    import wave

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(44_100)
        frames = bytearray()
        for index in range(44_100 * 2):
            value = int(12_000 * math.sin(2 * math.pi * 880 * index / 44_100))
            frames += struct.pack("<h", value)
        handle.writeframes(bytes(frames))
    return buffer.getvalue()


@pytest.fixture
def business_settings(tmp_path):
    from bird_business.config import BusinessSettings

    return BusinessSettings(environment="test", database_path=tmp_path / "observations.sqlite3")
