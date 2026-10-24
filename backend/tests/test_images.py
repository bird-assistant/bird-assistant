from __future__ import annotations

import pytest

from bird_vision.config import Settings
from bird_vision.errors import ServiceError
from bird_vision.images import decode_image


def test_decode_jpeg(jpeg_bytes: bytes) -> None:
    image, decode_ms = decode_image(jpeg_bytes, "image/jpeg", Settings(environment="test"))
    assert image.size == (320, 240)
    assert image.mode == "RGB"
    assert decode_ms >= 0


def test_rejects_non_image() -> None:
    with pytest.raises(ServiceError) as caught:
        decode_image(b"not an image", "image/jpeg", Settings(environment="test"))
    assert caught.value.code == "IMAGE_DECODE_FAILED"


def test_rejects_oversized_payload(jpeg_bytes: bytes) -> None:
    settings = Settings(environment="test", max_image_bytes=1024)
    with pytest.raises(ServiceError) as caught:
        decode_image(jpeg_bytes, "image/jpeg", settings)
    assert caught.value.code == "IMAGE_TOO_LARGE"
