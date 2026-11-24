import json
from threading import BoundedSemaphore
from time import time

from fastapi import APIRouter, Response
from fastapi.responses import FileResponse

from bird_business.community import DB, taxon
from bird_business.community_store import missing
from bird_business.field_guide import fetch_reference, guide
from bird_common.errors import ServiceError

router = APIRouter(prefix="/api/v1/species", tags=["field-guide"])
slots = BoundedSemaphore(3)


@router.get("/{species}/reference")
def reference(species: str, database: DB):
    with database.transaction() as db:
        bird = taxon(db, species)
        local = guide(database.catalog_dir, species)["photo"]
        if local:
            return {"photo": local}
        existing = db.execute(
            "SELECT metadata,checked FROM field_photos WHERE species=?", (species,)
        ).fetchone()
        if existing and (existing["metadata"] or existing["checked"] > time() - 86400 * 7):
            return {"photo": json.loads(existing["metadata"]) if existing["metadata"] else None}
    if not slots.acquire(blocking=False):
        raise ServiceError("GUIDE_BUSY", "参考图库繁忙，请稍后再试", 503)
    try:
        result = fetch_reference(bird["scientific"])
        with database.transaction() as db:
            metadata, jpeg = result if result else (None, None)
            db.execute(
                "INSERT INTO field_photos VALUES(?,?,?,?) ON CONFLICT(species) DO UPDATE SET "
                "metadata=excluded.metadata,jpeg=excluded.jpeg,checked=excluded.checked "
                "WHERE field_photos.metadata IS NULL",
                (species, json.dumps(metadata) if metadata else None, jpeg, time()),
            )
            saved = db.execute("SELECT metadata FROM field_photos WHERE species=?", (species,)).fetchone()[0]
        return {"photo": json.loads(saved) if saved else None}
    except (OSError, ValueError) as error:
        raise ServiceError("GUIDE_UNAVAILABLE", "参考图库暂不可用", 503) from error
    finally:
        slots.release()


@router.get("/{species}/photo")
def reference_photo(species: str, database: DB):
    with database.transaction() as db:
        taxon(db, species)
        if guide(database.catalog_dir, species)["photo"]:
            return FileResponse(
                database.catalog_dir / "guide_images" / (species + ".jpg"), media_type="image/jpeg"
            )
        row = db.execute(
            "SELECT jpeg FROM field_photos WHERE species=? AND jpeg IS NOT NULL", (species,)
        ).fetchone()
        if row:
            return Response(
                row[0], media_type="image/jpeg", headers={"Cache-Control": "public,max-age=86400"}
            )
        raise missing()
