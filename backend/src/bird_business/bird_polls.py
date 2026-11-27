from bird_business.community_store import blocked, missing, now, one
from bird_common.errors import ServiceError


def poll_summary(db, post, viewer):
    poll = one(db, "SELECT result FROM bird_polls WHERE post=?", post["id"])
    candidates = [
        dict(row)
        for row in db.execute(
            "SELECT t.id, coalesce(nullif(t.name,''),nullif(t.english,''),t.scientific) name, "
            "count(*) votes FROM bird_votes v JOIN taxa t ON t.id=v.species WHERE v.post=? "
            "GROUP BY t.id ORDER BY votes DESC,name,t.id",
            (post["id"],),
        )
    ]
    mine = db.execute(
        "SELECT species FROM bird_votes WHERE post=? AND member=?", (post["id"], viewer)
    ).fetchone()
    return {
        "candidates": candidates,
        "total": sum(item["votes"] for item in candidates),
        "mine": mine[0] if mine else None,
        "owner": post["owner"] == viewer,
        "result": next((item for item in candidates if item["id"] == poll["result"]), None),
    }


def vote(db, post, member, species):
    if not species:
        raise ServiceError("SPECIES_REQUIRED", "请选择名录中的鸟种", 422)
    if blocked(db, member, post["owner"]):
        raise missing()
    one(db, "SELECT id FROM taxa WHERE id=?", species)
    if one(db, "SELECT result FROM bird_polls WHERE post=?", post["id"])[0]:
        raise ServiceError("POLL_CLOSED", "楼主已采纳鉴定结果", 409)
    changed = db.execute(
        "INSERT INTO bird_votes VALUES(?,?,?) ON CONFLICT(post,member) DO UPDATE "
        "SET species=excluded.species WHERE species!=excluded.species",
        (post["id"], member, species),
    ).rowcount
    if changed:
        db.execute("UPDATE bird_polls SET updated=? WHERE post=?", (now(), post["id"]))


def resolve_poll(db, post, member, species):
    if post["owner"] != member:
        raise missing()
    current = one(db, "SELECT result FROM bird_polls WHERE post=?", post["id"])[0]
    if current == species:
        return
    if current:
        raise ServiceError("POLL_CLOSED", "楼主已采纳鉴定结果", 409)
    one(db, "SELECT 1 FROM bird_votes WHERE post=? AND species=?", post["id"], species)
    db.execute("UPDATE bird_polls SET result=?,updated=? WHERE post=?", (species, now(), post["id"]))
