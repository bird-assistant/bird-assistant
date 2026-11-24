import json
from datetime import UTC, date, datetime, timedelta
from hashlib import sha256
from math import asin, cos, radians, sin, sqrt
from threading import BoundedSemaphore
from time import monotonic
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field

from bird_business.community import DB, Member, limited, taxon
from bird_business.community_store import now
from bird_business.trip_advice import BEIJING
from bird_business.trip_evidence import TripEvidence
from bird_business.trip_harness import dump, run_harness
from bird_business.trip_parks import park_points
from bird_common.errors import ServiceError

router = APIRouter(prefix="/api/v1/map", tags=["trip-planner"])
SLOTS = BoundedSemaphore(4)
Question = Annotated[str, Field(min_length=1, max_length=240)]


class Trip(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    date: date
    startHour: int = Field(ge=0, le=23)
    hours: Literal[1, 2, 3, 4]
    radius: Literal[10, 30, 80]
    species: str = Field(default="", max_length=100)
    question: Question
    requestId: str = Field(pattern=r"^[a-zA-Z0-9_-]{8,80}$")
    parentTurn: str | None = Field(default=None, pattern=r"^[a-f0-9]{32}$")


def distance(lat, lon, other_lat, other_lon):
    arc = (
        sin(radians(other_lat - lat) / 2) ** 2
        + cos(radians(lat)) * cos(radians(other_lat)) * sin(radians(other_lon - lon) / 2) ** 2
    )
    return 12742 * asin(sqrt(min(1, arc)))


def nearby(db, point, radius, species, today, month):
    rows = db.execute(
        """SELECT p.id,p.lat,p.lon,p.day,p.species,t.name,t.english,
        json_extract(p.display,'$.placeName') place FROM publications p JOIN taxa t ON t.id=p.species
        WHERE p.channel='map' AND p.status='approved' AND t.sensitive=0 AND p.lat BETWEEN ? AND ?
        AND p.lon IS NOT NULL AND p.day BETWEEN ? AND ? AND (?='' OR p.species=?)
        ORDER BY p.day DESC,p.id""",
        (
            point["latitude"] - radius / 110,
            point["latitude"] + radius / 110,
            (today - timedelta(days=365)).isoformat(),
            today.isoformat(),
            species,
            species,
        ),
    )
    sites = {}
    for row in rows:
        lat, lon = row["lat"], row["lon"]
        km = distance(point["latitude"], point["longitude"], lat, lon)
        if km > radius:
            continue
        site = sites.setdefault(
            (lat, lon),
            {
                "name": row["place"] or "公开鸟讯区域",
                "point": {"latitude": lat, "longitude": lon},
                "km": round(km, 1),
                "count": 0,
                "latest": row["day"],
                "seasonal": 0,
                "birds": {},
            },
        )
        site["count"] += 1
        site["seasonal"] += int(row["day"][5:7] == month)
        bird = site["birds"].setdefault(
            row["species"],
            {
                "id": row["species"],
                "name": row["name"] or row["english"],
                "record": row["id"],
                "latest": row["day"],
                "count": 0,
            },
        )
        bird["count"] += 1
    for site in sites.values():
        site["richness"] = len(site["birds"])
        site["birds"] = sorted(
            site["birds"].values(), key=lambda bird: (bird["count"], bird["latest"]), reverse=True
        )[:4]
    return list(sites.values())


def requested_taxon(db, body, history):
    if body.species:
        return taxon(db, body.species)
    for question in [body.question, *(row["content"] for row in reversed(history) if row["role"] == "user")]:
        if any(term in question for term in ("所有鸟种", "不限鸟种", "不限定鸟种")):
            return {}
        found = db.execute(
            """SELECT * FROM taxa WHERE (length(name)>=2 AND instr(?,name)>0)
            OR (instr(name,'(')>1 AND instr(?,trim(substr(name,1,instr(name,'(')-1)))>0)
            OR (instr(name,'(')>1 AND instr(?,rtrim(substr(name,instr(name,'(')+1),')'))>0)
            OR (length(english)>2 AND instr(lower(?),lower(english))>0)
            ORDER BY length(name) DESC LIMIT 1""",
            (question, question, question, question),
        ).fetchone()
        if found:
            return dict(found)
    return {}


def local_parks(point, radius):
    parks = []
    for park in park_points():
        km = distance(
            point["latitude"], point["longitude"], park["point"]["latitude"], park["point"]["longitude"]
        )
        if km <= radius:
            parks.append({**park, "km": round(km, 1)})
    return sorted(parks, key=lambda park: park["km"])


def reserve(db, owner, body, current, settings):
    expiry = (current - timedelta(hours=1)).astimezone(UTC).isoformat()
    db.execute("DELETE FROM trip_turns WHERE created<?", (expiry,))
    db.execute("DELETE FROM trip_requests WHERE created<?", (expiry,))
    fingerprint = sha256(body.model_dump_json().encode()).hexdigest()
    existing = db.execute(
        "SELECT * FROM trip_turns WHERE owner=? AND request=?", (owner, body.requestId)
    ).fetchone()
    if existing:
        if existing["fingerprint"] != fingerprint:
            raise ServiceError("TRIP_CONFLICT", "本次请求编号已用于其他问题", 409)
        if existing["response"]:
            return existing["turn"], [], json.loads(existing["response"])
        raise ServiceError("TRIP_IN_PROGRESS", "本次咨询正在处理，请稍后重试", 409)
    history = []
    if body.parentTurn:
        parent = db.execute(
            "SELECT history FROM trip_turns WHERE owner=? AND turn=? AND history IS NOT NULL",
            (owner, body.parentTurn),
        ).fetchone()
        if not parent:
            raise ServiceError("TRIP_EXPIRED", "对话已过期，请开启新咨询", 410)
        history = json.loads(parent["history"])
    if not settings.trip_api_key.get_secret_value():
        raise ServiceError("TRIP_NOT_CONFIGURED", "管理员尚未配置云端模型 API", 503)
    limited(db, "trip_requests", "owner", owner, 12)
    if db.execute("SELECT count(*) FROM trip_requests").fetchone()[0] >= settings.trip_global_hourly:
        raise ServiceError("TRIP_QUOTA", "本小时出行咨询额度已用完", 429)
    turn = uuid4().hex
    db.execute("INSERT INTO trip_requests(owner,created) VALUES(?,?)", (owner, now()))
    db.execute(
        "INSERT INTO trip_turns(owner,request,turn,fingerprint,created) VALUES(?,?,?,?,?)",
        (owner, body.requestId, turn, fingerprint, now()),
    )
    return turn, history, None


def collect(database, body, history, current, start):
    point = {"latitude": round(body.latitude, 1), "longitude": round(body.longitude, 1)}
    with database.transaction() as db:
        focus = requested_taxon(db, body, history)
        sites = nearby(db, point, body.radius, focus.get("id", ""), current.date(), body.date.strftime("%m"))
    closest = sorted(sites, key=lambda site: site["km"])[:4]
    recent = sorted(sites, key=lambda site: site["latest"], reverse=True)[:2]
    richest = sorted(sites, key=lambda site: (site["richness"], site["seasonal"]), reverse=True)[:2]
    selection = []
    for site in [*closest, *recent, *richest]:
        if site not in selection:
            selection.append(site)
    parks = [] if focus.get("sensitive") else local_parks(point, body.radius)[:4]
    evidence = TripEvidence(database, point, start, body.hours, selection, parks)
    context = {
        "question": body.question,
        "focus": focus.get("name") or focus.get("english") or "",
        "start": start.isoformat(),
        "hours": body.hours,
        "radiusKm": body.radius,
        "areaGCJ02": point,
        "protectedSpecies": bool(focus.get("sensitive")),
    }
    return context, evidence


@router.post("/trip-plan")
def trip_plan(body: Trip, request: Request, database: DB, owner: Member):
    settings = request.app.state.settings
    metrics = request.app.state.metrics
    current = datetime.now(BEIJING)
    start = datetime.combine(body.date, datetime.min.time(), BEIJING).replace(hour=body.startHour)
    if not current.date() <= body.date <= current.date() + timedelta(days=6) or start < current.replace(
        minute=0, second=0, microsecond=0
    ):
        raise ServiceError("TRIP_TIME", "请选择未来七天内尚未结束的出发时段", 422)
    if not SLOTS.acquire(blocking=False):
        raise ServiceError("TRIP_BUSY", "出行顾问正在处理其他咨询，请稍后重试", 429)
    turn = None
    try:
        with database.transaction() as db:
            turn, history, cached = reserve(db, owner, body, current, settings)
        if cached is not None:
            metrics.trip_runs.labels("cached").inc()
            return cached
        deadline = monotonic() + 48
        context, evidence = collect(database, body, history, current, start)
        answer, trace = run_harness(settings, context, history, evidence, deadline)
        response = {
            **evidence.render(answer),
            "turn": turn,
            "engine": "dashscope",
            "model": settings.trip_model,
            "focus": context["focus"],
            "start": start.isoformat(),
            "end": (start + timedelta(hours=body.hours)).isoformat(),
            "trace": trace,
        }
        turns = [
            *history,
            {"role": "user", "content": body.question},
            {"role": "assistant", "content": answer.answer},
        ][-6:]
        with database.transaction() as db:
            db.execute(
                "UPDATE trip_turns SET history=?,response=? WHERE turn=?", (dump(turns), dump(response), turn)
            )
        metrics.trip_runs.labels("success").inc()
        metrics.trip_tokens.inc(trace["tokens"])
        return response
    except Exception as error:
        metrics.trip_runs.labels(error.code if isinstance(error, ServiceError) else "internal").inc()
        if turn:
            with database.transaction() as db:
                db.execute("DELETE FROM trip_turns WHERE turn=? AND response IS NULL", (turn,))
        raise
    finally:
        SLOTS.release()
