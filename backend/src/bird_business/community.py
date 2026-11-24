from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime, timedelta
from io import BytesIO
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request, Response, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

from bird_business.community_geo import display_point
from bird_business.community_models import Adopt, Decision, Message, Preview, Reply, Report, Sighting, Submit
from bird_business.community_store import (
    CommunityStore,
    blocked,
    encode,
    identifier,
    member_card,
    missing,
    now,
    one,
    relationship,
    uid,
)
from bird_business.field_guide import field_marks, guide, observation_thumbnail
from bird_common.auth import Principal, require_principal
from bird_common.errors import ServiceError

router = APIRouter(tags=["field-community"])
ROOT = "/api/v1/community"


def store(request: Request) -> CommunityStore:
    return request.app.state.community


def member(request: Request, principal: Annotated[Principal, Depends(require_principal)]) -> str:
    return store(request).member(principal.subject)


def public_reader(request: Request) -> str | None:
    if request.headers.get("authorization") or request.headers.get("x-api-key"):
        return store(request).member(request.app.state.auth.verify_request(request).subject)
    return None


DB = Annotated[CommunityStore, Depends(store)]
Member = Annotated[str, Depends(member)]
Limit = Annotated[int, Query(ge=1, le=100)]


def conflict():
    return ServiceError("CONFLICT", "request conflicts with existing record", 409)


def limited(db, table, column, owner, maximum):
    start = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
    if (
        db.execute(f"SELECT count(*) FROM {table} WHERE {column}=? AND created>?", (owner, start)).fetchone()[
            0
        ]
        >= maximum
    ):
        raise ServiceError("RATE_LIMIT", "try again later", 429)


def taxon(db, species):
    return dict(one(db, "SELECT * FROM taxa WHERE id=?", species)) if species else {}


def species_name(row):
    return row.get("name") or row.get("english") or row.get("scientific") or "待鉴定"


@router.get("/api/v1/species")
def search_species(
    database: DB, q: Annotated[str, Query(max_length=128)] = "", limit: Limit = 30, featured: bool = False
):
    with database.transaction() as db:
        query = "%" + q + "%"
        rows = db.execute(
            "SELECT * FROM taxa WHERE name LIKE ? OR scientific LIKE ? OR english LIKE ? "
            'ORDER BY (name=?) DESC,(name!="") DESC,name,scientific LIMIT ?',
            (query, query, query, q, limit),
        )
        result = {"items": [dict(row) for row in rows], "source": "AviList v2026 · CC BY 4.0"}
        if featured and not q:
            examples = db.execute(
                "SELECT id,name,english FROM taxa WHERE scientific IN (?,?,?,?) ORDER BY name",
                ("Passer montanus", "Passer domesticus", "Parus major", "Cyanistes caeruleus"),
            )
            result["featured"] = [
                {**dict(bird), "photo": guide(database.catalog_dir, bird["id"])["photo"]} for bird in examples
            ]
        return result


@router.get("/api/v1/species/{species}")
def species_detail(species: str, database: DB):
    with database.transaction() as db:
        return {
            **guide_record(db, database, species),
            "source": "AviList v2026 · CC BY 4.0",
            "records": [
                public(row)
                for row in db.execute(
                    "SELECT * FROM publications WHERE species=? AND status='approved' "
                    "ORDER BY created DESC LIMIT 60",
                    (species,),
                )
            ],
        }


def guide_record(db, database, species):
    bird = taxon(db, species)
    profile = guide(database.catalog_dir, species)
    if not profile["photo"]:
        cached = db.execute("SELECT metadata FROM field_photos WHERE species=?", (species,)).fetchone()
        if cached and cached[0]:
            profile["photo"] = json.loads(cached[0])
    return {**bird, "guide": {**profile, **field_marks(bird["scientific"])}}


@router.get("/api/v1/species/{species}/guide")
def identification_guide(species: str, database: DB):
    with database.transaction() as db:
        return guide_record(db, database, species)


@router.get("/api/v2/observations/by-reference/{reference}")
def find_observation(reference: str, database: DB, owner: Member):
    with database.transaction() as db:
        row = db.execute("SELECT id FROM sightings WHERE owner=? AND ref=?", (owner, reference)).fetchone()
        return {"id": row[0] if row else None, "channels": channel_status(db, row[0], owner) if row else []}


def channel_status(db, record, owner):
    rows = db.execute(
        "SELECT p.id,p.channel,p.status,p.created,coalesce(f.reason,'') reason "
        "FROM publications p LEFT JOIN review_feedback f ON f.target=p.id "
        "WHERE p.sighting=? AND p.owner=? ORDER BY p.created DESC,p.id",
        (record, owner),
    )
    return [dict(row) for row in rows]


@router.get("/api/v1/species/{species}/places")
def species_places(
    species: str,
    database: DB,
    startDate: str = "",
    endDate: str = "",
    origin: Literal["all", "local", "external"] = "all",
    limit: Limit = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    with database.transaction() as db:
        taxon(db, species)
        filters = """ FROM publications WHERE channel='map' AND status='approved' AND species=:species
            AND lat IS NOT NULL AND lon IS NOT NULL AND (:start='' OR day>=:start)
            AND (:end='' OR (day!='' AND day<=:end)) AND (:origin='all' OR
            (:origin='external' AND owner='gbif') OR (:origin='local' AND owner!='gbif')) GROUP BY lat,lon"""
        args = dict(species=species, start=startDate, end=endDate, origin=origin, limit=limit, offset=offset)
        count, records = db.execute(
            "SELECT count(*),coalesce(sum(n),0) FROM (SELECT count(*) n" + filters + ")", args
        ).fetchone()
        rows = db.execute(
            "SELECT lat,lon,count(*) n,max(day) latest,min(json_extract(display,'$.placeName')) label"
            + filters
            + " ORDER BY latest DESC,lat,lon LIMIT :limit OFFSET :offset",
            args,
        )
        return {
            "placeCount": count,
            "recordCount": records,
            "items": [
                {
                    "id": f"{row['lat']},{row['lon']}",
                    "placeName": row["label"],
                    "latest": row["latest"],
                    "records": row["n"],
                    "displayLocation": {"latitude": row["lat"], "longitude": row["lon"]},
                }
                for row in rows
            ],
        }


@router.post(ROOT + "/media", status_code=201)
def upload(file: UploadFile, database: DB, owner: Member):
    if file.size and file.size > 24 * 1024 * 1024:
        raise ServiceError("IMAGE_TOO_LARGE", "image too large", 413)
    try:
        with Image.open(file.file, formats=["JPEG", "PNG", "WEBP"]) as source:
            if source.width * source.height > 52_000_000:
                raise ServiceError("IMAGE_TOO_LARGE", "image too large", 413)
            exif = source.getexif()
            capture = exif.get_ifd(34665)
            camera = {
                key: str(value)[:100]
                for key, value in {
                    "make": exif.get(271),
                    "model": exif.get(272),
                    "exposure": capture.get(33434),
                    "aperture": capture.get(33437),
                    "iso": capture.get(34855),
                    "focal": capture.get(37386),
                }.items()
                if value is not None
            }
            source.draft("RGB", (2000, 2000))
            image = ImageOps.exif_transpose(source).convert("RGB")
            image.thumbnail((1600, 1600))
            output = BytesIO()
            image.save(output, "JPEG", quality=85, exif=b"")
    except (OSError, ValueError, SyntaxError, UnidentifiedImageError, Image.DecompressionBombError):
        raise ServiceError("INVALID_IMAGE", "cannot decode image", 422) from None
    data = output.getvalue()
    photo = identifier(owner, data)
    with database.transaction() as db:
        if not db.execute("SELECT 1 FROM photos WHERE id=?", (photo,)).fetchone():
            limited(db, "photos", "owner", owner, 30)
            db.execute("INSERT INTO photos VALUES(?,?,?,?,?)", (photo, owner, data, encode(camera), now()))
    return {"id": photo, "camera": camera}


@router.post("/api/v2/observations", status_code=201)
@router.put("/api/v2/observations/by-reference/{reference}")
def save_sighting(body: Sighting, database: DB, owner: Member, reference: str | None = None):
    if reference is not None and reference != body.reference:
        raise conflict()
    payload = body.model_dump(mode="json")
    payload["mapPoint"] = display_point(payload["point"], False) if body.point else None
    with database.transaction() as db:
        taxon(db, body.species)
        if body.media:
            media = one(db, "SELECT camera FROM photos WHERE id=? AND owner=?", body.media, owner)
            payload["camera"].update(json.loads(media["camera"]))
        existing = db.execute(
            "SELECT * FROM sightings WHERE owner=? AND ref=?", (owner, body.reference)
        ).fetchone()
        if existing:
            if existing["payload"] != encode(payload):
                if reference is None:
                    raise conflict()
                db.execute("UPDATE sightings SET payload=? WHERE id=?", (encode(payload), existing["id"]))
                invalidate_previews(db, existing["id"])
            return {"id": existing["id"]}
        limited(db, "sightings", "owner", owner, 100)
        record = uid("obs")
        db.execute(
            "INSERT INTO sightings VALUES(?,?,?,?,?)", (record, owner, body.reference, encode(payload), now())
        )
        return {"id": record}


def invalidate_previews(db, record):
    db.execute(
        "DELETE FROM previews WHERE sighting=? AND NOT EXISTS "
        "(SELECT 1 FROM publications WHERE preview=previews.id)",
        (record,),
    )


@router.get("/api/v2/observations")
def my_observations(database: DB, owner: Member, limit: Limit = 50, offset: Annotated[int, Query(ge=0)] = 0):
    with database.transaction() as db:
        rows = db.execute(
            "SELECT * FROM sightings WHERE owner=? ORDER BY created DESC LIMIT ? OFFSET ?",
            (owner, limit, offset),
        )
        return {"items": [{"id": row["id"], **json.loads(row["payload"])} for row in rows]}


@router.get("/api/v2/observations/{record}/photo")
def private_photo(record: str, database: DB, owner: Member):
    with database.transaction() as db:
        row = one(
            db,
            "SELECT jpeg FROM photos JOIN sightings ON photos.id=json_extract(payload,'$.media') "
            "WHERE sightings.id=? AND sightings.owner=? AND photos.owner=?",
            record,
            owner,
            owner,
        )
        return Response(row[0], media_type="image/jpeg", headers={"Cache-Control": "private, no-store"})


@router.post(ROOT + "/previews")
def preview(body: Preview, database: DB, owner: Member):
    with database.transaction() as db:
        sighting = (
            json.loads(
                one(db, "SELECT payload FROM sightings WHERE id=? AND owner=?", body.sighting, owner)[
                    "payload"
                ]
            )
            if body.sighting
            else {}
        )
        species = taxon(db, sighting.get("species"))
        citation = None
        if body.external:
            source = one(
                db,
                "SELECT species,display FROM publications WHERE id=? AND owner='gbif' AND status='approved'",
                body.external,
            )
            citation = body.external
            if not species:
                species = taxon(db, source["species"])
        point = sighting.get("point")
        if "map" in body.channels and (not point or species.get("sensitive") or not species):
            raise ServiceError(
                "MAP_LOCATION_RESTRICTED", "map requires location and a non-sensitive confirmed species", 422
            )
        media = (body.media or sighting.get("media")) if body.share_photo else None
        if media:
            one(db, "SELECT id FROM photos WHERE owner=? AND id=?", owner, media)
        value = {
            "speciesId": species.get("id", ""),
            "sourceRecord": citation,
            "speciesName": species_name(species),
            "title": body.title or species_name(species),
            "body": body.body,
            "anonymous": body.anonymous,
            "publicName": "匿名鸟友" if body.anonymous else member_card(db, owner)["nickname"],
            "memberId": None if body.anonymous else owner,
            "date": sighting.get("date") if body.share_date else None,
            "camera": {key: val for key, val in sighting.get("camera", {}).items() if val}
            if body.share_camera
            else {},
            "source": "羽迹社区",
            "media": media,
            "coordinateSystem": "GCJ-02",
        }
        displays = {
            channel: {
                **value,
                "displayLocation": display_point(point) if channel == "map" else None,
                "placeName": "约十公里范围" if channel == "map" else "",
            }
            for channel in body.channels
        }
        preview_id = uid("preview")
        limited(db, "previews", "owner", owner, 100)
        db.execute(
            "INSERT INTO previews VALUES(?,?,?,?,?,?)",
            (preview_id, owner, body.sighting, encode(displays), encode(sorted(body.channels)), now()),
        )
        return {
            "id": preview_id,
            "display": {key: {**val, "media": bool(val["media"])} for key, val in displays.items()},
        }


@router.post(ROOT + "/publications", status_code=201)
def publish(body: Submit, database: DB, owner: Member):
    with database.transaction() as db:
        item = one(db, "SELECT * FROM previews WHERE id=? AND owner=?", body.preview, owner)
        existing = db.execute(
            "SELECT id,channel,status FROM publications WHERE preview=?", (body.preview,)
        ).fetchall()
        if existing:
            return {"items": [dict(row) for row in existing]}
        if datetime.now(UTC) - datetime.fromisoformat(item["created"]) > timedelta(minutes=30):
            raise conflict()
        result = []
        for channel, display in json.loads(item["payload"]).items():
            record = uid(channel)
            point = display.get("displayLocation") or {}
            db.execute(
                "INSERT INTO publications VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    record,
                    owner,
                    body.preview,
                    channel,
                    item["sighting"],
                    "pending",
                    encode(display),
                    display["speciesId"],
                    point.get("latitude"),
                    point.get("longitude"),
                    display["date"] or "",
                    now(),
                ),
            )
            result.append({"id": record, "channel": channel, "status": "pending"})
        return {"items": result}


def public(row: sqlite3.Row) -> dict:
    info = json.loads(row["display"])
    media = info.pop("media", None)
    return {
        **info,
        "id": row["id"],
        "channel": row["channel"],
        "status": row["status"],
        "visibility": "public",
        "observedAt": None,
        "updatedAt": row["created"],
        "image": ROOT + "/publications/" + row["id"] + "/photo" if media or info.get("sourcePhoto") else "",
    }


def visible(db, record):
    return one(db, "SELECT * FROM publications WHERE id=? AND status='approved'", record)


@router.get(ROOT + "/publications/{record}/photo")
def photo(record: str, database: DB):
    with database.transaction() as db:
        row = visible(db, record)
        display = json.loads(row["display"])
        external_photo = display.get("sourcePhoto") if row["owner"] == "gbif" else None
        if not external_photo:
            contents = one(
                db, "SELECT jpeg FROM photos WHERE id=? AND owner=?", display.get("media"), row["owner"]
            )["jpeg"]
            return Response(contents, media_type="image/jpeg", headers={"Cache-Control": "no-store"})
    try:
        return Response(
            observation_thumbnail(external_photo["download"]),
            media_type="image/jpeg",
            headers={"Cache-Control": "public,max-age=600"},
        )
    except (OSError, ValueError) as error:
        raise ServiceError("PHOTO_UNAVAILABLE", "原社区照片暂不可用", 503) from error


@router.get(ROOT + "/publications/{record}")
def detail(record: str, database: DB, owner: Annotated[str | None, Depends(public_reader)]):
    with database.transaction() as db:
        row = visible(db, record)
        reactions = [
            item[0]
            for item in db.execute("SELECT kind FROM reactions WHERE post=? AND owner=?", (record, owner))
        ]
        related = db.execute(
            "SELECT id,channel FROM publications WHERE preview=? AND id!=? AND status='approved'",
            (row["preview"], record),
        ).fetchone()
        return {
            **public(row),
            "related": dict(related) if related else None,
            "ownedSighting": row["sighting"] if row["owner"] == owner else None,
            "reactions": reactions,
            "bookmarked": "bookmark" in reactions,
            "likes": db.execute(
                "SELECT count(*) FROM reactions WHERE post=? AND kind='like'", (record,)
            ).fetchone()[0],
            "replies": [
                {**dict(reply), "publicName": member_card(db, reply["memberId"])["nickname"]}
                for reply in db.execute(
                    "SELECT id,owner memberId,body,species,created FROM replies WHERE post=? "
                    "AND status='approved' "
                    "ORDER BY created DESC LIMIT 100",
                    (record,),
                )
            ],
        }


@router.get(ROOT + "/posts")
def feed(database: DB, species: str = "", limit: Limit = 40, offset: Annotated[int, Query(ge=0)] = 0):
    with database.transaction() as db:
        rows = db.execute(
            "SELECT * FROM publications WHERE status='approved' AND channel='post' AND (?='' OR species=?) "
            "ORDER BY created DESC,id LIMIT ? OFFSET ?",
            (species, species, limit, offset),
        )
        return {"items": [public(row) for row in rows]}


@router.get(ROOT + "/external")
def external(database: DB, limit: Limit = 60, offset: Annotated[int, Query(ge=0)] = 0):
    with database.transaction() as db:
        rows = db.execute(
            "SELECT * FROM publications WHERE owner='gbif' AND status='approved' "
            "ORDER BY day DESC,id LIMIT ? OFFSET ?",
            (limit + 1, offset),
        ).fetchall()
        return {"items": [public(row) for row in rows[:limit]], "hasMore": len(rows) > limit}


@router.get(ROOT + "/mine")
def mine(database: DB, owner: Member):
    with database.transaction() as db:
        return {
            "items": [
                {**public(row), "ownedSighting": row["sighting"], "reason": row["reason"]}
                for row in db.execute(
                    "SELECT p.*, coalesce(f.reason,'') reason FROM publications p "
                    "LEFT JOIN review_feedback f ON f.target=p.id WHERE p.owner=? "
                    "ORDER BY p.created DESC LIMIT 100",
                    (owner,),
                )
            ]
        }


@router.delete(ROOT + "/publications/{record}", status_code=204)
def withdraw(record: str, database: DB, owner: Member):
    with database.transaction() as db:
        one(db, "SELECT id FROM publications WHERE owner=? AND id=?", owner, record)
        db.execute("UPDATE publications SET status='withdrawn' WHERE id=?", (record,))
    return Response(status_code=204)


@router.get("/api/v1/map/observations")
def map_records(
    database: DB,
    owner: Member,
    minLatitude: float = Query(-90, ge=-90, le=90),
    maxLatitude: float = Query(90, ge=-90, le=90),
    minLongitude: float = Query(-180, ge=-180, le=180),
    maxLongitude: float = Query(180, ge=-180, le=180),
    scope: Literal["all", "public", "mine"] = "all",
    origin: Literal["all", "local", "external"] = "all",
    coordinateSystem: Literal["GCJ-02"] = "GCJ-02",
    speciesId: str = "",
    startDate: str = "",
    endDate: str = "",
    cursor: str = "",
    limit: Limit = 60,
    zoom: Annotated[int | None, Query(ge=3, le=20)] = None,
):
    if minLatitude > maxLatitude or (startDate and endDate and startDate > endDate):
        raise ServiceError("INVALID_BOUNDS", "invalid map filters", 422)
    source = """WITH records AS (
        SELECT id,created,lat,lon,species,day,'public' visibility FROM publications
        WHERE status='approved' AND channel='map' AND :scope!='mine'
        AND (:origin='all' OR (:origin='external' AND owner='gbif') OR (:origin='local' AND owner!='gbif'))
        UNION ALL SELECT id,created,json_extract(payload,'$.mapPoint.latitude'),
        json_extract(payload,'$.mapPoint.longitude'),
        coalesce(json_extract(payload,'$.species'),''),coalesce(json_extract(payload,'$.date'),''),'private'
        FROM sightings
        WHERE owner=:owner AND :scope!='public' AND :origin!='external')
        SELECT * FROM records WHERE lat BETWEEN :south AND :north AND
        ((:west<=:east AND lon BETWEEN :west AND :east) OR (:west>:east AND (lon>=:west OR lon<=:east)))
        AND (:species='' OR species=:species OR (:species='__unknown__' AND species=''))
        AND (:start='' OR day>=:start) AND (:end='' OR (day!='' AND day<=:end))"""
    args = dict(
        scope=scope,
        origin=origin,
        owner=owner,
        west=minLongitude,
        east=maxLongitude,
        north=maxLatitude,
        south=minLatitude,
        species=speciesId,
        start=startDate,
        end=endDate,
        limit=limit + 1,
    )
    with database.transaction() as db:
        if zoom is not None:
            span = (
                (maxLongitude - minLongitude) % 360
                if minLongitude > maxLongitude
                else maxLongitude - minLongitude
            )
            step = 360 / 2 ** (zoom + 2)
            while step * 32 < max(span, maxLatitude - minLatitude):
                step *= 2
            args["step"] = step
            groups = db.execute(
                """SELECT count(*) AS size, avg(lat) AS lat, avg(lon) AS lon,
                min(lat) AS south, max(lat) AS north, min(lon) AS west, max(lon) AS east
                FROM ("""
                + source
                + """) GROUP BY cast((lat+90)/:step AS integer),
                cast((lon+180)/:step AS integer)""",
                args,
            )
            clusters = [
                dict(
                    count=row["size"],
                    latitude=row["lat"],
                    longitude=row["lon"],
                    minLatitude=row["south"],
                    maxLatitude=row["north"],
                    minLongitude=row["west"],
                    maxLongitude=row["east"],
                )
                for row in groups
            ]
            return {"total": sum(group["count"] for group in clusters), "clusters": clusters}
        total = db.execute("SELECT count(*) FROM (" + source + ")", args).fetchone()[0]
        if cursor:
            stamp, sep, key = cursor.partition("|")
            if not sep or len(cursor) > 160:
                raise ServiceError("INVALID_CURSOR", "invalid map cursor", 422)
            source += " AND (created,id)<(:stamp,:key)"
            args.update(stamp=stamp, key=key)
        rows = db.execute(source + " ORDER BY created DESC,id DESC LIMIT :limit", args).fetchall()
        items = []
        for row in rows[:limit]:
            if row["visibility"] == "public":
                items.append(public(visible(db, row["id"])))
            else:
                data = json.loads(
                    one(db, "SELECT payload FROM sightings WHERE id=? AND owner=?", row["id"], owner)[0]
                )
                items.append(
                    {
                        "id": row["id"],
                        "visibility": "private",
                        "speciesId": row["species"],
                        "speciesName": species_name(taxon(db, row["species"])),
                        "day": row["day"],
                        "date": row["day"],
                        "placeName": data["place"],
                        "displayLocation": data["mapPoint"],
                        "source": "我的观察",
                        "coordinateSystem": coordinateSystem,
                    }
                )
        next_cursor = rows[limit - 1]["created"] + "|" + rows[limit - 1]["id"] if len(rows) > limit else ""
        return {"items": items, "nextCursor": next_cursor, "total": total}


@router.get("/api/v1/map/observations/{record}")
def map_detail(record: str, database: DB, owner: Member):
    with database.transaction() as db:
        if record.startswith("obs_"):
            row = one(db, "SELECT payload FROM sightings WHERE id=? AND owner=?", record, owner)
            data = json.loads(row["payload"])
            return {
                "id": record,
                "channels": channel_status(db, record, owner),
                **data,
                "visibility": "private",
                "displayLocation": data["mapPoint"],
                "coordinateSystem": "GCJ-02",
                "speciesId": data["species"],
                "speciesName": species_name(taxon(db, data["species"])),
            }
        row = visible(db, record)
        if row["channel"] != "map":
            raise missing()
        return public(row)


@router.post(ROOT + "/publications/{record}/replies", status_code=201)
def reply(record: str, body: Reply, database: DB, owner: Member):
    with database.transaction() as db:
        visible(db, record)
        taxon(db, body.species)
        existing = db.execute(
            "SELECT * FROM replies WHERE owner=? AND ref=?", (owner, body.reference)
        ).fetchone()
        if existing:
            if (existing["post"], existing["body"], existing["species"]) != (record, body.body, body.species):
                raise conflict()
            return {"id": existing["id"], "status": existing["status"]}
        limited(db, "replies", "owner", owner, 40)
        key = uid("reply")
        db.execute(
            "INSERT INTO replies VALUES(?,?,?,?,?,?,?,?)",
            (key, record, owner, body.body, body.species, "pending", now(), body.reference),
        )
        return {"id": key, "status": "pending"}


@router.post("/api/v2/observations/{record}/adopt")
def adopt(record: str, body: Adopt, database: DB, owner: Member):
    with database.transaction() as db:
        sighting = one(db, "SELECT payload FROM sightings WHERE owner=? AND id=?", owner, record)
        suggestion = one(
            db,
            "SELECT r.species FROM replies r JOIN publications p ON p.id=r.post WHERE "
            "r.id=? AND r.status='approved' AND p.status='approved' AND p.sighting=? AND p.owner=? "
            "AND r.species IS NOT NULL",
            body.reply,
            record,
            owner,
        )
        data = json.loads(sighting["payload"])
        if not db.execute("SELECT 1 FROM identifications WHERE reply=?", (body.reply,)).fetchone():
            data["species"] = suggestion["species"]
            db.execute("UPDATE sightings SET payload=? WHERE id=?", (encode(data), record))
            invalidate_previews(db, record)
            db.execute(
                "INSERT INTO identifications VALUES(?,?,?,?,?)",
                (uid("ident"), record, body.reply, suggestion["species"], now()),
            )
        return data


@router.put(ROOT + "/publications/{record}/{kind}")
@router.delete(ROOT + "/publications/{record}/reactions/{kind}")
def react(record: str, kind: Literal["like", "bookmark"], request: Request, database: DB, owner: Member):
    with database.transaction() as db:
        visible(db, record)
        if request.method == "PUT":
            db.execute("INSERT OR IGNORE INTO reactions VALUES(?,?,?)", (owner, record, kind))
        else:
            db.execute("DELETE FROM reactions WHERE owner=? AND post=? AND kind=?", (owner, record, kind))
        return {"active": request.method == "PUT"}


@router.get(ROOT + "/bookmarks")
def bookmarks(database: DB, owner: Member):
    with database.transaction() as db:
        return {
            "items": [
                public(row)
                for row in db.execute(
                    "SELECT p.* FROM publications p JOIN reactions r "
                    "ON p.id=r.post WHERE r.owner=? AND r.kind='bookmark' AND p.status='approved' "
                    "ORDER BY p.created DESC LIMIT 100",
                    (owner,),
                )
            ]
        }


@router.get(ROOT + "/me")
def growth(database: DB, owner: Member):
    with database.transaction() as db:
        sightings = db.execute("SELECT count(*) FROM sightings WHERE owner=?", (owner,)).fetchone()[0]
        contributions = db.execute(
            "SELECT count(DISTINCT preview) FROM publications WHERE owner=? AND status='approved'", (owner,)
        ).fetchone()[0]
        answers = db.execute(
            "SELECT count(*) FROM replies WHERE owner=? AND status='approved'", (owner,)
        ).fetchone()[0]
        return {
            "id": owner,
            "observations": sightings,
            "contributions": contributions,
            "replies": answers,
            "points": sightings + 5 * contributions + 2 * answers,
            "badges": [
                label
                for label, unlocked in [
                    ("初次记录", sightings >= 1),
                    ("社区贡献者", contributions >= 1),
                    ("观鸟笔记家", sightings >= 10),
                    ("热心鸟友", answers >= 3),
                ]
                if unlocked
            ],
        }


@router.get(ROOT + "/inbox")
def inbox(database: DB, owner: Member):
    with database.transaction() as db:
        return {
            "items": [
                {
                    **dict(row),
                    "profile": member_card(db, row["peer"]),
                    "unread": db.execute(
                        "SELECT count(*) FROM messages WHERE sender=? AND recipient=? AND created>COALESCE("
                        "(SELECT stamp FROM chat_reads WHERE owner=? AND peer=?),'')",
                        (row["peer"], owner, owner, row["peer"]),
                    ).fetchone()[0],
                }
                for row in db.execute(
                    "SELECT * FROM (SELECT id,body,created, "
                    "CASE WHEN sender=? THEN recipient ELSE sender END peer, row_number() OVER "
                    "(PARTITION BY CASE WHEN sender=? THEN recipient ELSE sender END "
                    "ORDER BY created DESC) pos "
                    "FROM messages WHERE sender=? OR recipient=?) WHERE pos=1 "
                    "AND NOT EXISTS (SELECT 1 FROM blocks WHERE (owner=? AND member=peer) "
                    "OR (member=? AND owner=peer)) "
                    "ORDER BY created DESC LIMIT 100",
                    (owner, owner, owner, owner, owner, owner),
                )
            ]
        }


@router.get(ROOT + "/messages/{peer}")
def messages(peer: str, database: DB, owner: Member, before: str = ""):
    with database.transaction() as db:
        if blocked(db, owner, peer):
            raise missing()
        rows = db.execute(
            "SELECT id,sender,body,created FROM messages WHERE ((sender=? AND recipient=?) OR "
            "(sender=? AND recipient=?)) AND (?='' OR created<?) ORDER BY created DESC LIMIT 60",
            (peer, owner, owner, peer, before, before),
        ).fetchall()
        return {"items": [dict(row) for row in reversed(rows)]}


@router.post(ROOT + "/messages/{peer}", status_code=201)
def send(peer: str, body: Message, database: DB, owner: Member):
    with database.transaction() as db:
        one(db, "SELECT id FROM members WHERE id=?", peer)
        if (
            peer == owner
            or db.execute(
                "SELECT 1 FROM blocks WHERE (owner=? AND member=?) OR (owner=? AND member=?)",
                (peer, owner, owner, peer),
            ).fetchone()
        ):
            raise ServiceError("MESSAGE_UNAVAILABLE", "message unavailable", 403)
        previous = db.execute(
            "SELECT * FROM messages WHERE sender=? AND ref=?", (owner, body.reference)
        ).fetchone()
        if previous:
            if previous["recipient"] != peer or previous["body"] != body.body:
                raise conflict()
            return {"id": previous["id"]}
        settings = db.execute("SELECT dm FROM profiles WHERE member=?", (peer,)).fetchone()
        if settings and settings[0] == "friends" and relationship(db, owner, peer) != "friends":
            raise ServiceError("FRIENDS_ONLY", "recipient accepts messages from friends", 403)
        limited(db, "messages", "sender", owner, 60)
        key = uid("msg")
        db.execute(
            "INSERT INTO messages VALUES(?,?,?,?,?,?)", (key, owner, peer, body.body, now(), body.reference)
        )
        return {"id": key}


@router.put(ROOT + "/blocks/{peer}")
@router.delete(ROOT + "/blocks/{peer}")
def block(peer: str, request: Request, database: DB, owner: Member):
    with database.transaction() as db:
        one(db, "SELECT id FROM members WHERE id=?", peer)
        if request.method == "PUT":
            if owner == peer:
                raise conflict()
            db.execute("INSERT OR IGNORE INTO blocks VALUES(?,?)", (owner, peer))
            db.execute("DELETE FROM friendships WHERE first=? AND second=?", sorted((owner, peer)))
            db.execute(
                "DELETE FROM group_members WHERE state='invited' AND "
                "((member=? AND invited_by=?) OR (member=? AND invited_by=?))",
                (owner, peer, peer, owner),
            )
        else:
            db.execute("DELETE FROM blocks WHERE owner=? AND member=?", (owner, peer))
        return {"blocked": request.method == "PUT"}


@router.post(ROOT + "/reports/{record}")
def report(record: str, body: Report, database: DB, owner: Member):
    with database.transaction() as db:
        if record.startswith("msg_"):
            one(db, "SELECT id FROM messages WHERE id=? AND recipient=?", record, owner)
        elif record.startswith("gmsg_"):
            one(
                db,
                "SELECT m.id FROM group_messages m JOIN group_members g ON g.room=m.room "
                "WHERE m.id=? AND g.member=? AND g.state='joined' AND m.created>=g.joined AND m.sender!=?",
                record,
                owner,
                owner,
            )
        else:
            visible(db, record)
        db.execute("INSERT OR IGNORE INTO reports VALUES(?,?,?,?)", (owner, record, body.reason, now()))
        return {"received": True}


def reviewer(principal: Annotated[Principal, Depends(require_principal)]):
    if not principal.subject.startswith("api-key:"):
        raise ServiceError("FORBIDDEN", "staff credential required", 403)
    return principal.subject


@router.get(ROOT + "/moderation")
def queue(database: DB, staff: Annotated[str, Depends(reviewer)]):
    with database.transaction() as db:
        photos = [
            public(row)
            for row in db.execute(
                "SELECT * FROM publications WHERE status='pending' ORDER BY created LIMIT 100"
            )
        ]
        replies = [
            dict(row)
            for row in db.execute(
                "SELECT id,post,body,species FROM replies WHERE status='pending' ORDER BY created LIMIT 100"
            )
        ]
        return {
            "publications": photos,
            "replies": replies,
            "reports": [
                dict(row)
                for row in db.execute(
                    "SELECT r.target,r.reason,r.created,coalesce(m.body,g.body) reportedMessage "
                    "FROM reports r LEFT JOIN messages m ON m.id=r.target "
                    "LEFT JOIN group_messages g ON g.id=r.target ORDER BY r.created DESC LIMIT 100"
                )
            ],
        }


@router.get(ROOT + "/moderation/{record}/photo")
def review_photo(record: str, database: DB, staff: Annotated[str, Depends(reviewer)]):
    with database.transaction() as db:
        return moderation_photo(db, record)


def moderation_photo(db, record):
    row = one(db, "SELECT owner,display FROM publications WHERE id=?", record)
    media = json.loads(row["display"]).get("media")
    return Response(
        one(db, "SELECT jpeg FROM photos WHERE owner=? AND id=?", row["owner"], media)[0],
        media_type="image/jpeg",
        headers={"Cache-Control": "no-store"},
    )


@router.post(ROOT + "/moderation/{record}")
def moderate(record: str, body: Decision, database: DB, staff: Annotated[str, Depends(reviewer)]):
    with database.transaction() as db:
        if record.startswith(("msg_", "gmsg_")):
            return decide_report(db, record, body.status, staff)
        return decide_publication(db, record, body.status, staff)


def log_decision(db, record, status, staff):
    db.execute("INSERT INTO decisions VALUES(?,?,?,?,?)", (uid("review"), record, staff, status, now()))


def decide_publication(db, record, status, staff, *, pending_only=False):
    table = "replies" if record.startswith("reply_") else "publications"
    row = one(db, f"SELECT status FROM {table} WHERE id=?", record)
    if row["status"] == "withdrawn" or (
        (pending_only or status == "approved") and row["status"] != "pending"
    ):
        raise conflict()
    db.execute(f"UPDATE {table} SET status=? WHERE id=?", (status, record))
    log_decision(db, record, status, staff)
    return {"id": record, "status": status}


def decide_report(db, record, status, staff):
    one(db, "SELECT 1 FROM reports WHERE target=?", record)
    if status == "rejected":
        if record.startswith(("msg_", "gmsg_")):
            chats = "messages" if record.startswith("msg_") else "group_messages"
            db.execute(f"UPDATE {chats} SET body=? WHERE id=?", ("[该消息已被管理员移除]", record))
        else:
            db.execute(
                "UPDATE publications SET status='rejected' WHERE id=? AND status='approved'", (record,)
            )
    db.execute("DELETE FROM reports WHERE target=?", (record,))
    log_decision(db, record, "report_removed" if status == "rejected" else "report_kept", staff)
    return {"id": record, "status": status}
