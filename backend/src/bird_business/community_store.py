from __future__ import annotations

import csv
import hashlib
import json
import sqlite3
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from threading import RLock

from bird_common.errors import ServiceError

SCHEMA = """
CREATE TABLE IF NOT EXISTS trip_requests(owner TEXT NOT NULL,created TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS trip_request_time ON trip_requests(created);
CREATE TABLE IF NOT EXISTS trip_turns(owner TEXT NOT NULL, request TEXT NOT NULL, turn TEXT NOT NULL UNIQUE,
 fingerprint TEXT NOT NULL, created TEXT NOT NULL, history TEXT, response TEXT, PRIMARY KEY(owner,request));
CREATE INDEX IF NOT EXISTS trip_turn_time ON trip_turns(created);
CREATE TABLE IF NOT EXISTS members(id TEXT PRIMARY KEY, subject TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS taxa(id TEXT PRIMARY KEY, scientific TEXT, name TEXT, english TEXT, family TEXT,
 sensitive INTEGER, version TEXT);
CREATE TABLE IF NOT EXISTS photos(id TEXT PRIMARY KEY, owner TEXT NOT NULL, jpeg BLOB NOT NULL, camera TEXT,
 created TEXT NOT NULL, UNIQUE(owner,id));
CREATE TABLE IF NOT EXISTS sightings(id TEXT PRIMARY KEY, owner TEXT NOT NULL, ref TEXT NOT NULL,
 payload TEXT NOT NULL, created TEXT NOT NULL, UNIQUE(owner,ref));
CREATE INDEX IF NOT EXISTS sighting_owner ON sightings(owner,created);
CREATE TABLE IF NOT EXISTS previews(id TEXT PRIMARY KEY, owner TEXT NOT NULL, sighting TEXT,
 payload TEXT NOT NULL,
 channels TEXT NOT NULL, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS publications(id TEXT PRIMARY KEY, owner TEXT NOT NULL, preview TEXT,
 channel TEXT NOT NULL,
 sighting TEXT, status TEXT NOT NULL, display TEXT NOT NULL, species TEXT NOT NULL, lat REAL, lon REAL,
 day TEXT NOT NULL, created TEXT NOT NULL, UNIQUE(preview,channel));
CREATE INDEX IF NOT EXISTS map_view ON publications(channel,status,lat,lon);
CREATE INDEX IF NOT EXISTS species_posts ON publications(species,status,channel,created);
CREATE TABLE IF NOT EXISTS replies(id TEXT PRIMARY KEY, post TEXT NOT NULL, owner TEXT NOT NULL, body TEXT,
 species TEXT, status TEXT NOT NULL, created TEXT NOT NULL, ref TEXT NOT NULL, UNIQUE(owner,ref));
CREATE TABLE IF NOT EXISTS reactions(owner TEXT,post TEXT,kind TEXT, PRIMARY KEY(owner,post,kind));
CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,sender TEXT,recipient TEXT,body TEXT,created TEXT,
 ref TEXT NOT NULL, UNIQUE(sender,ref));
CREATE INDEX IF NOT EXISTS message_recipient ON messages(recipient,created);
CREATE TABLE IF NOT EXISTS blocks(owner TEXT,member TEXT,PRIMARY KEY(owner,member));
CREATE TABLE IF NOT EXISTS reports(owner TEXT,target TEXT,reason TEXT,created TEXT,PRIMARY KEY(owner,target));
CREATE TABLE IF NOT EXISTS decisions(id TEXT PRIMARY KEY,target TEXT,reviewer TEXT,status TEXT,created TEXT);
CREATE TABLE IF NOT EXISTS review_feedback(target TEXT PRIMARY KEY, reason TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS field_photos(species TEXT PRIMARY KEY, metadata TEXT, jpeg BLOB, checked REAL);
CREATE INDEX IF NOT EXISTS published_observation ON publications(owner,sighting,created);
CREATE TABLE IF NOT EXISTS identifications(id TEXT PRIMARY KEY,sighting TEXT,reply TEXT UNIQUE,
 species TEXT,created TEXT);
CREATE TABLE IF NOT EXISTS profiles(member TEXT PRIMARY KEY, handle TEXT UNIQUE COLLATE NOCASE NOT NULL,
 nickname TEXT NOT NULL, avatar TEXT NOT NULL, bio TEXT NOT NULL, discoverable INTEGER NOT NULL,
 dm TEXT NOT NULL, bookmarks TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS friendships(first TEXT, second TEXT, requester TEXT NOT NULL, state TEXT NOT NULL,
 created TEXT NOT NULL, PRIMARY KEY(first,second));
CREATE INDEX IF NOT EXISTS friends_second ON friendships(second,state);
CREATE TABLE IF NOT EXISTS chat_reads(owner TEXT, peer TEXT, stamp TEXT NOT NULL, PRIMARY KEY(owner,peer));
CREATE TABLE IF NOT EXISTS bird_groups(id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL,
 created TEXT NOT NULL, ref TEXT NOT NULL, UNIQUE(owner,ref));
CREATE TABLE IF NOT EXISTS group_members(room TEXT, member TEXT, state TEXT NOT NULL,
 invited_by TEXT NOT NULL,
 joined TEXT NOT NULL, seen TEXT NOT NULL, PRIMARY KEY(room,member));
CREATE INDEX IF NOT EXISTS group_member_state ON group_members(member,state);
CREATE TABLE IF NOT EXISTS group_messages(id TEXT PRIMARY KEY,room TEXT NOT NULL,sender TEXT NOT NULL,
 body TEXT NOT NULL,created TEXT NOT NULL,ref TEXT NOT NULL,UNIQUE(sender,ref));
CREATE INDEX IF NOT EXISTS group_history ON group_messages(room,created);
"""


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="microseconds")


def uid(prefix: str) -> str:
    return prefix + "_" + uuid.uuid4().hex


def encode(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def missing() -> ServiceError:
    return ServiceError("NOT_FOUND", "record unavailable", 404)


def member_card(db, member):
    profile = db.execute(
        "SELECT member id,nickname,handle,avatar,bio FROM profiles WHERE member=?", (member,)
    ).fetchone()
    return (
        dict(profile)
        if profile
        else dict(id=member, nickname="鸟友 " + member[-6:], handle="", avatar="owl", bio="")
    )


def relationship(db, owner, peer):
    row = db.execute(
        "SELECT requester,state FROM friendships WHERE first=? AND second=?", sorted((owner, peer))
    ).fetchone()
    if not row or row["state"] == "friends":
        return "friends" if row else "none"
    return "outgoing" if row["requester"] == owner else "incoming"


def blocked(db, owner, peer):
    return (
        db.execute(
            "SELECT 1 FROM blocks WHERE (owner=? AND member=?) OR (owner=? AND member=?)",
            (owner, peer, peer, owner),
        ).fetchone()
        is not None
    )


def one(db: sqlite3.Connection, sql: str, *args: object) -> sqlite3.Row:
    row = db.execute(sql, args).fetchone()
    if row is None:
        raise missing()
    return row


class CommunityStore:
    def __init__(self, database: Path, catalog: Path):
        self.catalog_dir = catalog.parent
        self.lock = RLock()
        self.db = sqlite3.connect(str(database), timeout=10, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript(SCHEMA)
        with self.transaction() as db:
            if not db.execute("SELECT 1 FROM taxa LIMIT 1").fetchone():
                with catalog.open(encoding="utf-8-sig", newline="") as source:
                    db.executemany(
                        "INSERT INTO taxa VALUES(?,?,?,?,?,?,?)",
                        (
                            (
                                row["species_id"],
                                row["scientific_name"],
                                row["common_name_zh"],
                                row["common_name_en"],
                                row["family"],
                                row["iucn_status"] in {"VU", "EN", "CR"},
                                row["taxon_version"],
                            )
                            for row in csv.DictReader(source)
                            if row["enabled"].lower() == "true"
                        ),
                    )

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        with self.lock, self.db:
            yield self.db

    def member(self, subject: str) -> str:
        with self.transaction() as db:
            db.execute("INSERT OR IGNORE INTO members VALUES(?,?)", (uid("bird"), subject))
            return one(db, "SELECT id FROM members WHERE subject=?", subject)["id"]


def identifier(owner: str, data: bytes) -> str:
    return hashlib.sha256(owner.encode() + data).hexdigest()
