from __future__ import annotations

import http.client
import json
import math
import sqlite3
import time
import uuid
from contextlib import closing
from io import BytesIO
from pathlib import Path
from urllib.parse import urlencode

from PIL import Image

from bird_common.catalog import Taxon
from bird_common.errors import ServiceError


def multipart(fields: dict[str, str], image: bytes, mime: str) -> tuple[bytes, str]:
    boundary = uuid.uuid4().hex
    parts = [
        f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
        for name, value in fields.items()
    ]
    parts.extend(
        (
            f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="bird"\r\n'
            f"Content-Type: {mime}\r\n\r\n".encode(),
            image,
            f"\r\n--{boundary}--\r\n".encode(),
        )
    )
    return b"".join(parts), "multipart/form-data; boundary=" + boundary


class Dongniao:
    def __init__(self, key: str, ledger: Path, taxa: list[Taxon]):
        self.key = key
        self.ledger = ledger
        self.catalog = {taxon.scientific_name.casefold(): taxon for taxon in taxa if taxon.enabled}
        with closing(sqlite3.connect(ledger)) as db:
            db.execute("CREATE TABLE IF NOT EXISTS calls (at REAL NOT NULL)")

    def reserve(self) -> None:
        with closing(sqlite3.connect(self.ledger, timeout=2)) as db, db:
            db.execute("BEGIN IMMEDIATE")
            now = time.time()
            db.execute("DELETE FROM calls WHERE at <= ?", (now - 60,))
            if db.execute("SELECT COUNT(*) FROM calls").fetchone()[0] >= 60:
                raise ServiceError("PHOTO_REVIEW_BUSY", "external recognition rate limit", 429)
            db.execute("INSERT INTO calls VALUES (?)", (now,))

    def request(self, body: bytes, content_type: str, deadline: float):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise ServiceError("PHOTO_REVIEW_TIMEOUT", "external recognition timed out", 504)
        self.reserve()
        with closing(http.client.HTTPSConnection("ai.open.hhodata.com", timeout=min(5, remaining))) as conn:
            conn.request(
                "POST", "/api/v2/dongniao", body, {"api_key": self.key, "Content-Type": content_type}
            )
            reply = conn.getresponse()
            if reply.status == 429:
                raise ServiceError("PHOTO_REVIEW_BUSY", "external recognition rate limit", 429)
            if reply.status != 200:
                raise ServiceError("PHOTO_REVIEW_UNAVAILABLE", "external recognition unavailable", 503)
            pair = json.loads(reply.read(256 * 1024))
        if not isinstance(pair, list) or len(pair) != 2:
            raise ValueError("invalid recognition response")
        return pair

    def identify(self, source: Image.Image) -> list[dict]:
        if not self.key:
            raise ServiceError("PHOTO_REVIEW_UNAVAILABLE", "external recognition unavailable", 503)
        deadline = time.monotonic() + 18
        with source.copy() as resized:
            resized.thumbnail((1600, 1600))
            if min(resized.size) < 11:
                raise ServiceError("IMAGE_DIMENSIONS_INVALID", "image too small for recognition", 422)
            encoded = BytesIO()
            resized.info.clear()
            resized.save(encoded, "JPEG", quality=82)
            if encoded.tell() > 2_000_000:
                encoded = BytesIO()
                resized.save(encoded, "JPEG", quality=60)
            if encoded.tell() > 2_000_000:
                raise ServiceError("IMAGE_TOO_LARGE", "image too large for external recognition", 413)
            body, mime = multipart({"upload": "1", "class": "B"}, encoded.getvalue(), "image/jpeg")
            try:
                code, ticket = self.request(body, mime, deadline)
                if code != 1000 or not isinstance(ticket, str) or not 0 < len(ticket) <= 256:
                    raise ValueError("upload was not accepted")
                query = urlencode({"resultid": ticket}).encode()
                for delay in (0.5, 1, 2, 3, 4, 4):
                    time.sleep(delay)
                    code, result = self.request(query, "application/x-www-form-urlencoded", deadline)
                    if code == 1000 and isinstance(result, list):
                        return self.subjects(result, resized.size, source.size)
                    if code == 1010:
                        return []
                    if code != 1001 or result != ticket:
                        raise ValueError("recognition failed")
            except (ValueError, TypeError, OSError, sqlite3.Error, http.client.HTTPException) as exc:
                raise ServiceError(
                    "PHOTO_REVIEW_UNAVAILABLE", "external recognition unavailable", 503
                ) from exc
        raise ServiceError("PHOTO_REVIEW_TIMEOUT", "external recognition timed out", 504)

    def subjects(self, rows: list, size: tuple[int, int], original: tuple[int, int]) -> list[dict]:
        subjects = []
        for item in rows[:32]:
            box = item.get("box") if isinstance(item, dict) else None
            if not isinstance(box, list) or len(box) != 4 or not isinstance(item.get("list"), list):
                continue
            if not all(isinstance(value, (float, int)) and math.isfinite(value) for value in box):
                continue
            left, top, right, bottom = [
                max(0.0, min(1.0, value / size[index % 2])) for index, value in enumerate(box)
            ]
            if left >= right or top >= bottom:
                continue
            candidates = []
            for row in item["list"][:10]:
                if not isinstance(row, list) or len(row) != 4 or row[3] != "B" or not isinstance(row[1], str):
                    continue
                names = row[1].split("|")
                if len(names) != 3 or not names[2].strip():
                    continue
                confidence = row[0]
                if not isinstance(confidence, (int, float)) or not 0 <= confidence <= 100:
                    continue
                taxon = self.catalog.get(names[2].strip().casefold())
                candidates.append(
                    dict(
                        rank=len(candidates) + 1,
                        species_id=taxon.species_id if taxon else None,
                        scientific_name=names[2].strip(),
                        common_name_zh=names[0],
                        common_name_en=names[1],
                        score=confidence / 100,
                        score_type="dongniao_confidence",
                        mapped=bool(taxon),
                    )
                )
            subjects.append(
                dict(
                    rank=len(subjects) + 1,
                    bbox=dict(x1=left, y1=top, x2=right, y2=bottom),
                    short_side_px=min((right - left) * original[0], (bottom - top) * original[1]),
                    state="candidate" if candidates else "unknown",
                    reason="dongniao_review",
                    candidates=candidates,
                )
            )
        return subjects
