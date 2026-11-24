import json
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, SecretStr

from bird_business.admin_session import (
    COOKIE,
    LIFETIME,
    Session,
    authenticated,
    authorized_write,
    same_origin,
)
from bird_business.community import DB, decide_publication, decide_report, moderation_photo
from bird_business.community_models import Decision
from bird_business.community_store import one

router = APIRouter(prefix="/admin", include_in_schema=False)
ASSETS = Path(__file__).with_name("admin_web")
STAFF = "web:admin"
PAGE_SIZE = 12
Tab = Literal["post", "map", "reply", "reports", "history"]
HEADERS = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'self'; object-src 'none'; frame-ancestors 'none'; "
    "base-uri 'none'; form-action 'self'",
}


class Login(BaseModel):
    username: str = Field(max_length=64)
    password: SecretStr = Field(min_length=1, max_length=256)


@router.get("/")
def console():
    return FileResponse(ASSETS / "index.html", headers=HEADERS)


@router.get("/assets/{name}")
def asset(name: Literal["console.js", "console.css"]):
    return FileResponse(ASSETS / name, headers=HEADERS)


@router.post("/login", dependencies=[Depends(same_origin)])
def login(body: Login, request: Request, response: Response):
    sessions = request.app.state.admin_sessions
    token, session = sessions.login(
        request.client.host if request.client else "local", body.username, body.password.get_secret_value()
    )
    sessions.logout(request.cookies.get(COOKIE, ""))
    response.set_cookie(
        COOKIE, token, max_age=LIFETIME, secure=True, httponly=True, samesite="strict", path="/admin"
    )
    response.headers.update(HEADERS)
    return {"csrf": session.csrf}


@router.get("/session")
def session_info(response: Response, session: Annotated[Session, Depends(authenticated)]):
    response.headers.update(HEADERS)
    return {"csrf": session.csrf}


@router.post("/logout", dependencies=[Depends(authorized_write)])
def logout(request: Request, response: Response):
    request.app.state.admin_sessions.logout(request.cookies.get(COOKIE, ""))
    response.delete_cookie(COOKIE, path="/admin", secure=True, httponly=True, samesite="strict")
    response.headers.update(HEADERS)
    return {"ok": True}


def counts(db):
    total = {"post": 0, "map": 0}
    total.update(
        dict(db.execute("SELECT channel,count(*) FROM publications WHERE status='pending' GROUP BY channel"))
    )
    total["reply"] = db.execute("SELECT count(*) FROM replies WHERE status='pending'").fetchone()[0]
    total["reports"] = db.execute("SELECT count(DISTINCT target) FROM reports").fetchone()[0]
    total["history"] = db.execute("SELECT count(*) FROM decisions").fetchone()[0]
    return total


def publication_row(row):
    display = json.loads(row["display"])
    return {
        "id": row["id"],
        "created": row["created"],
        "title": display.get("title"),
        "body": display.get("body"),
        "species": display.get("speciesName"),
        "author": display.get("publicName"),
        "date": display.get("date"),
        "point": display.get("displayLocation"),
        "photo": bool(display.get("media")),
    }


def report_rows(db, offset):
    targets = db.execute(
        "SELECT target id,max(created) created FROM reports GROUP BY target "
        "ORDER BY created DESC,id LIMIT ? OFFSET ?",
        (PAGE_SIZE, offset),
    )
    items = []
    for target in targets:
        record = target["id"]
        publication = db.execute(
            "SELECT id,created,display FROM publications WHERE id=?", (record,)
        ).fetchone()
        item = publication_row(publication) if publication else {}
        if record.startswith(("msg_", "gmsg_")):
            table = "messages" if record.startswith("msg_") else "group_messages"
            message = db.execute(f"SELECT body FROM {table} WHERE id=?", (record,)).fetchone()
            item.update(title="被举报的消息", body=message[0] if message else "原消息已删除")
        reasons = db.execute("SELECT reason FROM reports WHERE target=? ORDER BY created DESC", (record,))
        items.append({**item, **dict(target), "reasons": [row[0] for row in reasons]})
    return items


@router.get("/queue", dependencies=[Depends(authenticated)])
def queue(
    database: DB, response: Response, tab: Tab = "post", page: Annotated[int, Query(ge=1, le=1000000)] = 1
):
    with database.transaction() as db:
        totals = counts(db)
        pages = max(1, (totals[tab] + PAGE_SIZE - 1) // PAGE_SIZE)
        page = min(page, pages)
        offset = (page - 1) * PAGE_SIZE
        if tab in {"post", "map"}:
            rows = db.execute(
                "SELECT id,created,display FROM publications WHERE status='pending' AND channel=? "
                "ORDER BY created,id LIMIT ? OFFSET ?",
                (tab, PAGE_SIZE, offset),
            )
            items = [publication_row(row) for row in rows]
        elif tab == "reply":
            rows = db.execute(
                "SELECT r.id,r.created,r.body,r.species,json_extract(p.display,'$.title') title "
                "FROM replies r LEFT JOIN publications p ON p.id=r.post WHERE r.status='pending' "
                "ORDER BY r.created,r.id LIMIT ? OFFSET ?",
                (PAGE_SIZE, offset),
            )
            items = [dict(row) for row in rows]
        elif tab == "reports":
            items = report_rows(db, offset)
        else:
            rows = db.execute(
                "SELECT target id,created,status,reviewer FROM decisions "
                "ORDER BY created DESC,id LIMIT ? OFFSET ?",
                (PAGE_SIZE, offset),
            )
            items = [dict(row) for row in rows]
    response.headers.update(HEADERS)
    return {"items": items, "counts": totals, "page": page, "pages": pages}


@router.get("/photos/{record}", dependencies=[Depends(authenticated)])
def photo(record: str, database: DB):
    with database.transaction() as db:
        one(
            db,
            "SELECT id FROM publications WHERE id=? AND (status='pending' OR EXISTS "
            "(SELECT 1 FROM reports WHERE target=publications.id))",
            record,
        )
        response = moderation_photo(db, record)
        response.headers.update(HEADERS)
        return response


@router.post("/actions/{kind}/{record}", dependencies=[Depends(authorized_write)])
def decide(kind: Literal["pending", "report"], record: str, body: Decision, database: DB, response: Response):
    with database.transaction() as db:
        if kind == "report":
            result = decide_report(db, record, body.status, STAFF)
        else:
            result = decide_publication(db, record, body.status, STAFF, pending_only=True)
    response.headers.update(HEADERS)
    return result
