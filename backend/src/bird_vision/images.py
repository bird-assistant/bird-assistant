from __future__ import annotations

import time
import warnings
from io import BytesIO

from PIL import Image, ImageOps, UnidentifiedImageError

from bird_vision.config import Settings
from bird_vision.errors import ServiceError

ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}
ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}


def decode_image(data: bytes, content_type: str | None, settings: Settings) -> tuple[Image.Image, float]:
    started = time.perf_counter()
    if not data:
        raise ServiceError("EMPTY_IMAGE", "uploaded image is empty", 422)
    if len(data) > settings.max_image_bytes:
        raise ServiceError(
            "IMAGE_TOO_LARGE",
            "uploaded image exceeds the byte limit",
            413,
            {"max_bytes": settings.max_image_bytes, "actual_bytes": len(data)},
        )
    normalized_type = (content_type or "").split(";", 1)[0].strip().lower()
    if normalized_type and normalized_type not in ALLOWED_CONTENT_TYPES:
        raise ServiceError(
            "UNSUPPORTED_IMAGE_TYPE",
            "only JPEG, PNG and WebP images are accepted",
            415,
            {"content_type": normalized_type},
        )
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as source:
                if source.format not in ALLOWED_FORMATS:
                    raise ServiceError("UNSUPPORTED_IMAGE_FORMAT", "unsupported image encoding", 415)
                width, height = source.size
                if width <= 0 or height <= 0 or width * height > settings.max_image_pixels:
                    raise ServiceError(
                        "IMAGE_DIMENSIONS_INVALID",
                        "decoded image dimensions exceed the configured limit",
                        413,
                        {"width": width, "height": height, "max_pixels": settings.max_image_pixels},
                    )
                source.load()
                ImageOps.exif_transpose(source, in_place=True)
                image = source.convert("RGB")
    except ServiceError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise ServiceError("IMAGE_DIMENSIONS_INVALID", "image dimensions are unsafe", 413) from exc
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise ServiceError("IMAGE_DECODE_FAILED", "image cannot be decoded", 422) from exc
    return image, (time.perf_counter() - started) * 1000
