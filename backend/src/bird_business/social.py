from typing import Annotated, Literal

from fastapi import APIRouter, Query
from pydantic import Field

from bird_business.community import DB, ROOT, Member, conflict, limited, public
from bird_business.community_models import Input
from bird_business.community_store import blocked, member_card, missing, now, one, relationship
from bird_common.errors import ServiceError

router = APIRouter(prefix=ROOT, tags=["birders"])


class Profile(Input):
    nickname: str = Field(min_length=1, max_length=24)
    handle: str = Field(pattern=r"^[a-zA-Z0-9_]{3,24}$")
    bio: str = Field(default="", max_length=160)
    avatar: Literal["owl", "finch", "leaf", "water", "mountain", "letter"] = "owl"
    discoverable: bool = True
    dm: Literal["everyone", "friends"] = "friends"
    bookmarks: Literal["private", "friends", "public"] = "private"


def registered(db, owner):
    if not db.execute("SELECT 1 FROM profiles WHERE member=?", (owner,)).fetchone():
        raise ServiceError("REGISTRATION_REQUIRED", "register a community profile first", 403)


def reachable(db, owner, peer):
    one(db, "SELECT id FROM members WHERE id=?", peer)
    if blocked(db, owner, peer):
        raise missing()


@router.get("/account")
def account(database: DB, owner: Member):
    with database.transaction() as db:
        row = db.execute("SELECT discoverable,dm,bookmarks FROM profiles WHERE member=?", (owner,)).fetchone()
        return {"id": owner, "profile": {**member_card(db, owner), **dict(row)} if row else None}


@router.put("/account")
def save_account(body: Profile, database: DB, owner: Member):
    with database.transaction() as db:
        handle = body.handle.lower()
        if db.execute("SELECT member FROM profiles WHERE handle=? AND member!=?", (handle, owner)).fetchone():
            raise ServiceError("HANDLE_TAKEN", "handle already taken", 409)
        db.execute(
            "INSERT INTO profiles VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(member) DO UPDATE SET "
            "handle=excluded.handle,nickname=excluded.nickname,avatar=excluded.avatar,bio=excluded.bio,"
            "discoverable=excluded.discoverable,dm=excluded.dm,bookmarks=excluded.bookmarks",
            (owner, handle, body.nickname, body.avatar, body.bio, body.discoverable, body.dm, body.bookmarks),
        )
        return {"id": owner}


@router.get("/members")
def search(database: DB, owner: Member, q: Annotated[str, Query(min_length=1, max_length=64)]):
    with database.transaction() as db:
        registered(db, owner)
        rows = db.execute(
            "SELECT member FROM profiles WHERE discoverable=1 AND member!=? AND "
            "(handle=lower(?) OR instr(nickname,?)>0) AND NOT EXISTS (SELECT 1 FROM blocks b "
            "WHERE (b.owner=? AND b.member=profiles.member) OR (b.member=? AND b.owner=profiles.member)) "
            "ORDER BY (handle=lower(?)) DESC,nickname,member LIMIT 40",
            (owner, q, q, owner, owner, q),
        )
        return {"items": [member_card(db, row[0]) for row in rows]}


@router.get("/members/{peer}")
def profile(peer: str, database: DB, owner: Member):
    with database.transaction() as db:
        reachable(db, owner, peer)
        status = relationship(db, owner, peer)
        settings = db.execute("SELECT bookmarks,dm FROM profiles WHERE member=?", (peer,)).fetchone()
        scope = settings["bookmarks"] if settings else "private"
        can_view = peer == owner or scope == "public" or (scope == "friends" and status == "friends")
        posts = db.execute(
            "SELECT * FROM publications WHERE owner=? AND channel='post' AND status='approved' "
            "AND json_extract(display,'$.memberId')=? ORDER BY created DESC LIMIT 50",
            (peer, peer),
        )
        saved = (
            db.execute(
                "SELECT p.* FROM reactions r JOIN publications p ON p.id=r.post "
                "WHERE r.owner=? AND r.kind='bookmark' AND p.status='approved' "
                "ORDER BY p.created DESC LIMIT 50",
                (peer,),
            )
            if can_view
            else []
        )
        return {
            "profile": member_card(db, peer),
            "relationship": status,
            "registered": bool(settings),
            "canMessage": owner != peer
            and (not settings or settings["dm"] == "everyone" or status == "friends"),
            "posts": [public(row) for row in posts],
            "bookmarks": [public(row) for row in saved],
            "showBookmarks": can_view,
        }


@router.get("/friends")
def friends(database: DB, owner: Member):
    with database.transaction() as db:
        registered(db, owner)
        rows = db.execute(
            "SELECT * FROM friendships WHERE first=? OR second=? ORDER BY created DESC", (owner, owner)
        )
        items = []
        for row in rows:
            peer = row["first"] if row["second"] == owner else row["second"]
            items.append({**member_card(db, peer), "relationship": relationship(db, owner, peer)})
        return {"items": items}


@router.put("/friends/{peer}/{action}")
def change_friend(
    peer: str,
    action: Literal["request", "accept", "decline", "cancel", "remove"],
    database: DB,
    owner: Member,
):
    with database.transaction() as db:
        registered(db, owner)
        reachable(db, owner, peer)
        registered(db, peer)
        if peer == owner:
            raise conflict()
        pair = sorted((owner, peer))
        state = relationship(db, owner, peer)
        if action == "request" and state == "none":
            limited(db, "friendships", "requester", owner, 40)
            db.execute("INSERT INTO friendships VALUES(?,?,?,'pending',?)", (*pair, owner, now()))
        elif action == "accept" and state == "incoming":
            db.execute("UPDATE friendships SET state='friends' WHERE first=? AND second=?", pair)
        elif (action, state) in {("remove", "friends"), ("decline", "incoming"), ("cancel", "outgoing")}:
            db.execute("DELETE FROM friendships WHERE first=? AND second=?", pair)
        elif (action, state) not in {
            ("request", "outgoing"),
            ("accept", "friends"),
            ("remove", "none"),
            ("decline", "none"),
            ("cancel", "none"),
        }:
            raise conflict()
        return {"relationship": relationship(db, owner, peer)}


@router.get("/blocks")
def blocked_list(database: DB, owner: Member):
    with database.transaction() as db:
        return {
            "items": [
                member_card(db, row[0])
                for row in db.execute("SELECT member FROM blocks WHERE owner=?", (owner,))
            ]
        }


@router.get("/activity")
def activity(database: DB, owner: Member):
    with database.transaction() as db:
        rows = db.execute(
            "SELECT r.id,r.post,r.owner,r.body,r.created FROM replies r JOIN publications p ON p.id=r.post "
            "WHERE p.owner=? AND r.owner!=? AND r.status='approved' AND p.status='approved' "
            "AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.owner=? AND b.member=r.owner) OR "
            "(b.member=? AND b.owner=r.owner)) ORDER BY r.created DESC LIMIT 50",
            (owner, owner, owner, owner),
        )
        return {
            "items": [{**dict(row), "nickname": member_card(db, row["owner"])["nickname"]} for row in rows]
        }


@router.put("/messages/{peer}/read/{message}")
def read_messages(peer: str, message: str, database: DB, owner: Member):
    with database.transaction() as db:
        stamp = one(
            db, "SELECT created FROM messages WHERE id=? AND recipient=? AND sender=?", message, owner, peer
        )[0]
        db.execute(
            "INSERT INTO chat_reads VALUES(?,?,?) ON CONFLICT(owner,peer) "
            "DO UPDATE SET stamp=max(stamp,excluded.stamp)",
            (owner, peer, stamp),
        )
        return {"read": True}
