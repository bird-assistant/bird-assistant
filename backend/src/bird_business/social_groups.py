from typing import Literal

from fastapi import APIRouter
from pydantic import Field

from bird_business.community import DB, ROOT, Member, conflict, limited
from bird_business.community_models import Input, Key, Message
from bird_business.community_store import member_card, now, one, relationship, uid
from bird_business.social import reachable, registered
from bird_common.errors import ServiceError

router = APIRouter(prefix=ROOT + "/groups", tags=["birding-groups"])


class NewGroup(Input):
    name: str = Field(min_length=1, max_length=40)
    reference: Key


def membership(db, room, owner, state="joined"):
    return one(db, "SELECT * FROM group_members WHERE room=? AND member=? AND state=?", room, owner, state)


@router.post("", status_code=201)
def create(body: NewGroup, database: DB, owner: Member):
    with database.transaction() as db:
        registered(db, owner)
        old = db.execute(
            "SELECT id,name FROM bird_groups WHERE owner=? AND ref=?", (owner, body.reference)
        ).fetchone()
        if old:
            if old["name"] != body.name:
                raise conflict()
            return {"id": old["id"]}
        limited(db, "bird_groups", "owner", owner, 10)
        room, stamp = uid("group"), now()
        db.execute(
            "INSERT INTO bird_groups VALUES(?,?,?,?,?)", (room, owner, body.name, stamp, body.reference)
        )
        db.execute("INSERT INTO group_members VALUES(?,?,'joined',?,?,?)", (room, owner, owner, stamp, stamp))
        return {"id": room}


VISIBLE = (
    "NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.owner=:owner AND b.member=m.sender) "
    "OR (b.member=:owner AND b.owner=m.sender))"
)


@router.get("")
def rooms(database: DB, owner: Member):
    with database.transaction() as db:
        rows = db.execute(
            "SELECT r.id,r.name,g.state,(SELECT count(*) FROM group_messages m WHERE m.room=r.id "
            "AND m.sender!=:owner AND m.created>g.seen AND g.state='joined' AND " + VISIBLE + ") unread "
            "FROM group_members g JOIN bird_groups r ON g.room=r.id WHERE g.member=:owner "
            "ORDER BY r.created DESC",
            {"owner": owner},
        )
        return {"items": [dict(row) for row in rows]}


@router.put("/{room}/invites/{peer}")
def invite(room: str, peer: str, database: DB, owner: Member):
    with database.transaction() as db:
        one(db, "SELECT id FROM bird_groups WHERE id=? AND owner=?", room, owner)
        reachable(db, owner, peer)
        if relationship(db, owner, peer) != "friends":
            raise ServiceError("FRIENDS_ONLY", "invite mutual friends", 403)
        if db.execute("SELECT count(*) FROM group_members WHERE room=?", (room,)).fetchone()[0] >= 100:
            raise conflict()
        db.execute("INSERT OR IGNORE INTO group_members VALUES(?,?,'invited',?,'','')", (room, peer, owner))
        return {"invited": True}


@router.put("/{room}/membership/{action}")
def join_or_leave(
    room: str, action: Literal["accept", "decline", "leave", "disband"], database: DB, owner: Member
):
    with database.transaction() as db:
        group = one(db, "SELECT owner FROM bird_groups WHERE id=?", room)
        membership(db, room, owner, "invited" if action in {"accept", "decline"} else "joined")
        if action == "accept":
            stamp = now()
            db.execute(
                "UPDATE group_members SET state='joined',joined=?,seen=? WHERE room=? AND member=?",
                (stamp, stamp, room, owner),
            )
        elif action == "disband" and group["owner"] == owner:
            db.execute("DELETE FROM group_members WHERE room=?", (room,))
            db.execute("DELETE FROM group_messages WHERE room=?", (room,))
            db.execute("DELETE FROM bird_groups WHERE id=?", (room,))
        elif action in {"decline", "leave"} and group["owner"] != owner:
            db.execute("DELETE FROM group_members WHERE room=? AND member=?", (room, owner))
        else:
            raise conflict()
        return {"ok": True}


@router.get("/{room}")
def history(room: str, database: DB, owner: Member, before: str = ""):
    with database.transaction() as db:
        joined = membership(db, room, owner)["joined"]
        group = one(db, "SELECT id,name,owner FROM bird_groups WHERE id=?", room)
        rows = db.execute(
            "SELECT id,sender,body,created FROM group_messages m WHERE room=:room AND created>=:joined "
            "AND (:before='' OR created<:before) AND " + VISIBLE + " ORDER BY created DESC LIMIT 60",
            dict(room=room, joined=joined, before=before, owner=owner),
        ).fetchall()
        members = db.execute("SELECT member FROM group_members WHERE room=? AND state='joined'", (room,))
        return {
            **dict(group),
            "members": [member_card(db, row[0]) for row in members],
            "items": [
                {**dict(row), "nickname": member_card(db, row["sender"])["nickname"]}
                for row in reversed(rows)
            ],
        }


@router.put("/{room}/read/{message}")
def mark_read(room: str, message: str, database: DB, owner: Member):
    with database.transaction() as db:
        membership(db, room, owner)
        stamp = one(db, "SELECT created FROM group_messages WHERE room=? AND id=?", room, message)[0]
        db.execute(
            "UPDATE group_members SET seen=max(seen,?) WHERE room=? AND member=?", (stamp, room, owner)
        )
        return {"read": True}


@router.post("/{room}/messages", status_code=201)
def send(room: str, body: Message, database: DB, owner: Member):
    with database.transaction() as db:
        membership(db, room, owner)
        old = db.execute(
            "SELECT * FROM group_messages WHERE sender=? AND ref=?", (owner, body.reference)
        ).fetchone()
        if old:
            if old["room"] != room or old["body"] != body.body:
                raise conflict()
            return {"id": old["id"]}
        limited(db, "group_messages", "sender", owner, 120)
        key = uid("gmsg")
        db.execute(
            "INSERT INTO group_messages VALUES(?,?,?,?,?,?)",
            (key, room, owner, body.body, now(), body.reference),
        )
        return {"id": key}
