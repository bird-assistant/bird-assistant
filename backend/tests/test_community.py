from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from bird_business.app import create_app
from bird_business.config import BusinessSettings
from bird_business.import_community import DATASET, snapshot


@pytest.fixture
def field(tmp_path):
    settings = BusinessSettings(
        database_path=tmp_path / "test.sqlite",
        api_keys="local-reviewer",
        allow_anonymous=False,
        mobile_signing_key="a" * 64,
    )
    app = create_app(settings)
    with TestClient(app) as client:
        users = [
            {"Authorization": "Bearer " + app.state.auth.issue(name)}
            for name in ("observer", "reader", "other")
        ]
        yield client, users, {"X-API-Key": "local-reviewer"}, app.state.community


ROOT = "/api/v1/community"
MAP = "/api/v1/map/observations"
OBS = "/api/v2/observations"


def test_gallery_validates_ownership_and_serves_every_approved_image_in_order(field):
    client, (author, reader, _), staff, _store = field
    assert client.get(ROOT + "/capabilities").json() == {"postGallery": 1, "maxImages": 9, "maxJournals": 3}

    def upload(color, who):
        data = BytesIO()
        Image.new("RGB", (40, 30), color).save(data, "PNG")
        response = client.post(ROOT + "/media", headers=who, files={"file": ("bird.png", data.getvalue())})
        assert response.status_code == 201
        return response.json()["id"]

    first, second, foreign = upload("red", author), upload("green", author), upload("blue", reader)
    images = [
        {"media": first},
        {"media": second, "kind": "journal", "label": "手帐", "manual_camera": {"iso": "100"}},
    ]
    payload = {
        "channels": ["post"],
        "body": "请帮忙鉴定",
        "share_photo": True,
        "identification_help": True,
        "media": first,
        "gallery": images,
    }

    def preview(**changes):
        return client.post(ROOT + "/previews", headers=author, json={**payload, **changes})

    assert preview(gallery=[*images, {"media": foreign}]).status_code == 404
    assert preview(gallery=images * 5).status_code == 422
    assert preview(media=second, gallery=[images[1]] * 4).status_code == 422
    assert preview(media=second).status_code == preview(share_photo=False).status_code == 422
    hidden = preview().json()["display"]["post"]["gallery"]
    assert all(item["camera"] == item["manualCamera"] == {} and "media" not in item for item in hidden)
    prepared = preview(share_camera=True).json()
    assert prepared["display"]["post"]["identificationHelp"]
    record = client.post(ROOT + "/publications", headers=author, json={"preview": prepared["id"]}).json()[
        "items"
    ][0]["id"]
    path = ROOT + "/publications/" + record
    assert client.get(path + "/photos/1").status_code == 404
    review = ROOT + "/moderation/" + record + "/photo"
    assert not client.get(review, params={"index": 1}, headers=reader).is_success
    expected = [client.get(review, headers=staff, params={"index": index}).content for index in (0, 1)]
    assert expected[0] != expected[1]
    assert client.post(ROOT + "/moderation/" + record, headers=staff, json={"status": "approved"}).is_success
    detail = client.get(path).json()
    assert detail["gallery"] == client.get(ROOT + "/posts").json()["items"][0]["gallery"]
    assert [item["kind"] for item in detail["gallery"]] == ["photo", "journal"]
    assert detail["gallery"][1]["manualCamera"] == {"iso": "100"}
    assert all("media" not in item for item in detail["gallery"])
    assert [client.get(item["image"]).content for item in detail["gallery"]] == expected
    assert client.get(detail["image"]).content == expected[0]
    assert client.get(path + "/photos/-1").status_code == client.get(path + "/photos/2").status_code == 404
    assert client.delete(path, headers=author).is_success
    assert all(client.get(item["image"]).status_code == 404 for item in detail["gallery"])


def test_unknown_bird_poll_votes_replies_result_and_author_feedback(field):
    client, (author, reader, other), staff, _store = field
    first, second = [row["id"] for row in client.get("/api/v1/species", params={"limit": 2}).json()["items"]]
    draft = {"body": "在芦苇里看见的是什么鸟？", "channels": ["post"], "identification_help": True}
    assert (
        client.post(ROOT + "/previews", headers=author, json={**draft, "species": first}).status_code == 422
    )

    def publish(payload):
        preview = client.post(ROOT + "/previews", headers=author, json=payload).json()
        assert bool(preview["display"]["post"].get("identificationHelp")) == payload["identification_help"]
        response = client.post(ROOT + "/publications", headers=author, json={"preview": preview["id"]})
        assert response.status_code == 201
        return response.json()["items"][0]["id"]

    record = publish(draft)
    path = ROOT + "/publications/" + record

    def choose(species, user=reader, action="vote"):
        return client.put(path + "/identification/" + action, headers=user, json={"species": species})

    def approve(post):
        response = client.post(ROOT + "/moderation/" + post, headers=staff, json={"status": "approved"})
        assert response.status_code == 200

    def updates(user):
        return client.get(ROOT + "/activity", headers=user).json()["identifications"]

    assert choose(first).status_code == 404
    approve(record)
    ordinary = publish({**draft, "identification_help": False})
    approve(ordinary)
    assert (
        client.put(
            ROOT + "/publications/" + ordinary + "/identification/vote",
            headers=reader,
            json={"species": first},
        ).status_code
        == 404
    )
    assert choose("unknown-species").status_code == 404
    assert choose(first, author, "resolve").status_code == 404
    assert not updates(author)
    assert choose(first).json()["total"] == choose(first).json()["total"] == 1
    assert choose(second).json()["mine"] == second
    reply = {"body": "翼上有白斑", "species": first, "reference": "wing", "identification_vote": True}
    sent = client.post(path + "/replies", headers=other, json=reply)
    assert sent.status_code == 201 and sent.json()["status"] == "pending"
    assert client.post(path + "/replies", headers=other, json=reply).json() == sent.json()
    detail = client.get(path).json()
    assert not detail["replies"] and not detail["poll"]["mine"] and not detail["poll"]["result"]
    assert {item["id"]: item["votes"] for item in detail["poll"]["candidates"]} == {first: 1, second: 1}
    assert choose(first, other, "resolve").status_code == 404
    result = choose(first, author, "resolve").json()
    assert result["result"]["id"] == first and result["total"] == 2
    assert choose(first, author, "resolve").json() == result
    assert choose(second, author, "resolve").status_code == choose(second).status_code == 409
    assert (
        client.post(path + "/replies", headers=reader, json={**reply, "reference": "late"}).status_code == 409
    )
    assert updates(author)[0]["poll"] == result and not updates(other)
    posts = {row["id"]: row for row in client.get(ROOT + "/posts").json()["items"]}
    assert posts[record]["poll"] == client.get(path).json()["poll"] and "poll" not in posts[ordinary]
    assert client.delete(path, headers=author).is_success
    assert not updates(author) and choose(first).status_code == 404


def test_ballot_retraction_only_removes_the_current_members_vote_and_is_idempotent(field):
    client, (author, reader, other), staff, _store = field
    first, second = [row["id"] for row in client.get("/api/v1/species", params={"limit": 2}).json()["items"]]
    preview = client.post(
        ROOT + "/previews",
        headers=author,
        json={"body": "这是什么鸟？", "channels": ["post"], "identification_help": True},
    ).json()
    record = client.post(ROOT + "/publications", headers=author, json={"preview": preview["id"]}).json()[
        "items"
    ][0]["id"]
    client.post(ROOT + "/moderation/" + record, headers=staff, json={"status": "approved"})
    path = ROOT + "/publications/" + record + "/identification/"
    assert client.put(path + "vote", headers=reader, json={"species": first}).status_code == 200
    assert client.put(path + "vote", headers=other, json={"species": second}).status_code == 200
    assert client.delete(path + "vote").status_code == 401
    result = client.delete(path + "vote", headers=reader)
    assert result.status_code == 200
    assert result.json()["mine"] is None and result.json()["total"] == 1
    assert result.json()["candidates"] == [
        {"id": second, "name": result.json()["candidates"][0]["name"], "votes": 1}
    ]
    assert client.delete(path + "vote", headers=reader).json() == result.json()
    assert client.get(ROOT + "/publications/" + record, headers=other).json()["poll"]["mine"] == second
    assert client.put(path + "vote", headers=reader, json={"species": first}).json()["total"] == 2
    assert client.put(path + "resolve", headers=author, json={"species": second}).status_code == 200
    assert client.delete(path + "vote", headers=reader).status_code == 409
    assert client.get(ROOT + "/publications/" + record).json()["poll"]["total"] == 2


def test_retraction_hides_non_polls_hidden_posts_and_blocked_relationships(field):
    client, (author, reader, _), staff, _store = field
    species = client.get("/api/v1/species", params={"limit": 1}).json()["items"][0]["id"]
    for help_requested in (False, True):
        preview = client.post(
            ROOT + "/previews",
            headers=author,
            json={"body": "看见一只鸟", "channels": ["post"], "identification_help": help_requested},
        ).json()
        record = client.post(ROOT + "/publications", headers=author, json={"preview": preview["id"]}).json()[
            "items"
        ][0]["id"]
        path = ROOT + "/publications/" + record + "/identification/vote"
        assert client.delete(path, headers=reader).status_code == 404
        client.post(ROOT + "/moderation/" + record, headers=staff, json={"status": "approved"})
        if not help_requested:
            assert client.delete(path, headers=reader).status_code == 404
            continue
        assert client.put(path, headers=reader, json={"species": species}).status_code == 200
        author_id = client.get(ROOT + "/me", headers=author).json()["id"]
        assert client.put(ROOT + "/blocks/" + author_id, headers=reader).status_code == 200
        assert client.delete(path, headers=reader).status_code == 404


def test_my_posts_and_bookmarks_include_the_same_reaction_counts_and_poll_as_feed(field):
    client, (author, reader, _), staff, _store = field
    species = client.get("/api/v1/species", params={"limit": 1}).json()["items"][0]["id"]
    preview = client.post(
        ROOT + "/previews",
        headers=author,
        json={"body": "一起辨鸟", "channels": ["post"], "identification_help": True},
    ).json()
    record = client.post(ROOT + "/publications", headers=author, json={"preview": preview["id"]}).json()[
        "items"
    ][0]["id"]
    client.post(ROOT + "/moderation/" + record, headers=staff, json={"status": "approved"})
    path = ROOT + "/publications/" + record
    assert (
        client.put(path + "/identification/vote", headers=reader, json={"species": species}).status_code
        == 200
    )
    assert client.put(path + "/like", headers=reader).status_code == 200
    assert client.put(path + "/bookmark", headers=reader).status_code == 200
    feed = next(
        row for row in client.get(ROOT + "/posts", headers=reader).json()["items"] if row["id"] == record
    )
    saved = next(
        row for row in client.get(ROOT + "/bookmarks", headers=reader).json()["items"] if row["id"] == record
    )
    mine = next(
        row for row in client.get(ROOT + "/mine", headers=author).json()["items"] if row["id"] == record
    )
    assert saved["poll"] == feed["poll"] and saved["reactions"] == feed["reactions"]
    assert mine["likes"] == saved["likes"] == 1
    assert mine["poll"]["total"] == 1 and mine["poll"]["owner"] is True
    assert client.get(ROOT + "/mine").status_code == client.get(ROOT + "/bookmarks").status_code == 401


def test_shared_photo_settings_are_allowlisted_and_standalone_posts_require_camera_consent(field):
    client, (author, _, _), _, _ = field
    buffer = BytesIO()
    exif = Image.Exif()
    exif[271], exif[272] = "Sony", "ILCE-7M4"
    exif[34665] = {
        42036: "FE 200-600mm",
        34855: 800,
        33434: 0.0005,
        33437: 6.3,
        37386: 600,
        41987: 0,
        37380: -0.33,
        37383: 3,
        37385: 0,
        42033: "private-camera-serial",
    }
    Image.new("RGB", (600, 400)).save(buffer, "JPEG", exif=exif)
    upload = client.post(ROOT + "/media", headers=author, files={"file": ("bird.jpg", buffer.getvalue())})
    assert upload.status_code == 201
    photo = upload.json()
    camera = photo["camera"]
    assert camera["resolution"] == "600 × 400 px"
    assert camera["lens"] == "FE 200-600mm"
    assert camera["whiteBalance"] == "AWB"
    assert camera["exposureBias"] == "-0.33 EV"
    assert camera["metering"] == "点测光" and camera["flash"] == "未闪光"
    assert "focusMode" not in camera and "private-camera-serial" not in str(camera)
    for share in (False, True):
        preview = client.post(
            ROOT + "/previews",
            headers=author,
            json={
                "body": "观察",
                "channels": ["post"],
                "media": photo["id"],
                "share_photo": True,
                "share_camera": share,
            },
        )
        assert preview.status_code == 200
        assert preview.json()["display"]["post"]["camera"] == (camera if share else {})


def test_malformed_or_unknown_exif_numbers_remain_unknown():
    from bird_business.community import capture_number

    for value in (None, "invalid", float("nan"), float("inf")):
        assert capture_number({37380: value}, 37380) is None
    assert capture_number({}, 37380) is None
    assert capture_number({37380: 0}, 37380) == 0


def test_field_guide_matches_photo_traits_and_caches_misses(field, monkeypatch):
    client, _, _, store = field
    species = "/api/v1/species/avibase-C22FBF8D"
    guide = client.get(species + "/guide").json()["guide"]
    assert "栗色" in guide["mark"] and len(guide["fields"]) == 7
    assert guide["photo"]["credit"] and guide["photo"]["license"] in {"CC BY 4.0", "CC0 1.0"}
    assert client.get(species + "/reference").json()["photo"] == guide["photo"]
    assert Image.open(BytesIO(client.get(species + "/photo").content)).format == "JPEG"
    assert client.get("/api/v1/species/unlisted/guide").status_code == 404
    from bird_business.field_guide import read_data

    seed = read_data(store.catalog_dir / "guide_photos.json")
    with store.transaction() as database:
        unseeded = next(row[0] for row in database.execute("SELECT id FROM taxa") if row[0] not in seed)
    calls = []
    monkeypatch.setattr("bird_business.guide_api.fetch_reference", lambda name: calls.append(name))
    for _ in range(2):
        assert client.get("/api/v1/species/" + unseeded + "/reference").json() == {"photo": None}
    assert len(calls) == 1


def test_registered_friends_inbox_and_privacy(field):
    client, (author, reader, outsider), staff, _store = field

    def call(method, path, who=author, payload=None, status=200):
        response = client.request(method, ROOT + path, headers=who, json=payload)
        assert response.status_code == status, response.text
        return response.json()

    first = call("GET", "/account")
    assert first["profile"] is None
    settings = {"handle": "Tit_001", "nickname": "山雀", "bookmarks": "friends"}
    author_id = call("PUT", "/account", author, settings)["id"]
    assert author_id == first["id"]
    call("PUT", "/account", reader, {**settings, "handle": "tit_001"}, 409)
    reader_id = call("PUT", "/account", reader, {"handle": "owl_002", "nickname": "猫头鹰"})["id"]
    call("PUT", "/account", outsider, {"handle": "hide_003", "nickname": "不参与搜索", "discoverable": False})
    assert call("GET", "/members?q=tit_001", reader)["items"][0]["nickname"] == "山雀"
    assert not call("GET", "/members?q=hide_003")["items"]

    def publish(anonymous):
        preview = call(
            "POST", "/previews", author, {"body": "公开观察", "channels": ["post"], "anonymous": anonymous}
        )
        post = call("POST", "/publications", author, {"preview": preview["id"]}, 201)["items"][0]["id"]
        call("POST", "/moderation/" + post, staff, {"status": "approved"})
        return post

    publication = publish(False)
    publish(True)
    call("PUT", "/publications/" + publication + "/bookmark")
    page = "/members/" + author_id
    assert [post["id"] for post in call("GET", page, reader)["posts"]] == [publication]
    assert not call("GET", page, reader)["showBookmarks"]
    request = "/friends/" + reader_id
    respond = "/friends/" + author_id
    payload = {"body": "一起去观鸟吗？", "reference": "hello"}
    call("POST", "/messages/" + reader_id, author, payload, 403)
    call("PUT", request + "/request")
    call("PUT", request + "/accept", status=409)
    assert call("GET", "/friends", reader)["items"][0]["relationship"] == "incoming"
    call("PUT", respond + "/decline", reader)
    call("PUT", request + "/request")
    call("PUT", request + "/cancel")
    call("PUT", request + "/request")
    call("PUT", respond + "/accept", reader)
    assert call("GET", page, reader)["bookmarks"][0]["id"] == publication
    assert not call("GET", page, outsider)["showBookmarks"]
    sent = call("POST", "/messages/" + reader_id, author, payload, 201)["id"]
    assert call("POST", "/messages/" + reader_id, author, payload, 201)["id"] == sent
    assert not call("GET", "/messages/" + author_id, outsider)["items"]
    assert call("GET", "/inbox", reader)["items"][0]["unread"] == 1
    call("PUT", "/messages/" + author_id + "/read/" + sent, outsider, status=404)
    call("PUT", "/messages/" + author_id + "/read/" + sent, reader)
    assert call("GET", "/inbox", reader)["items"][0]["unread"] == 0
    call("POST", "/reports/" + sent, reader, {"reason": "测试举报"})
    assert call("GET", "/moderation", staff)["reports"][0]["reportedMessage"] == payload["body"]
    call("POST", "/moderation/" + sent, staff, {"status": "rejected"})
    assert "移除" in call("GET", "/messages/" + author_id, reader)["items"][0]["body"]
    call("PUT", request + "/remove")
    assert not call("GET", page, reader)["showBookmarks"]
    call("PUT", request + "/request")
    call("PUT", "/blocks/" + author_id, reader)
    assert call("GET", "/blocks", reader)["items"][0]["id"] == author_id
    assert not call("GET", "/friends")["items"] and not call("GET", "/inbox", reader)["items"]
    assert not call("GET", "/members?q=owl_002")["items"]
    call("GET", page, reader, status=404)
    call("PUT", request + "/request", status=404)
    call("DELETE", "/blocks/" + author_id, reader)
    assert call("GET", page, reader)["relationship"] == "none"


def test_group_invite_consent_membership_and_history(field):
    client, users, _staff, _store = field

    def call(method, path, who=0, payload=None, status=200):
        response = client.request(method, ROOT + path, headers=users[who], json=payload)
        assert response.status_code == status, response.text
        return response.json()

    ids = [
        call("PUT", "/account", index, {"nickname": "鸟友", "handle": f"group_{index}"})["id"]
        for index in range(3)
    ]
    group = {"name": "清晨观鸟", "reference": "new"}
    room = "/groups/" + call("POST", "/groups", 0, group, 201)["id"]
    assert room.endswith(call("POST", "/groups", 0, group, 201)["id"])
    invite = room + "/invites/" + ids[1]
    call("PUT", invite, status=403)
    call("PUT", "/friends/" + ids[1] + "/request")
    call("PUT", "/friends/" + ids[0] + "/accept", 1)
    call("PUT", invite)
    assert call("GET", "/groups", 1)["items"][0]["state"] == "invited"
    call("GET", room, 1, status=404)
    call("PUT", room + "/membership/decline", 1)
    assert not call("GET", "/groups", 1)["items"]
    call("PUT", invite)
    call("POST", room + "/messages", 0, {"body": "入群前", "reference": "old"}, 201)
    call("PUT", room + "/membership/accept", 1)
    assert not call("GET", room, 1)["items"]
    message = {"body": "明早去观鸟", "reference": "greeting"}
    sent = call("POST", room + "/messages", 0, message, 201)["id"]
    assert sent == call("POST", room + "/messages", 0, message, 201)["id"]
    assert call("GET", "/groups", 1)["items"][0]["unread"] == 1
    call("PUT", room + "/read/" + sent, 1)
    assert call("GET", "/groups", 1)["items"][0]["unread"] == 0
    call("GET", room, 2, status=404)
    call("POST", room + "/messages", 2, message, 404)
    call("PUT", room + "/membership/disband", 1, status=409)
    call("POST", "/reports/" + sent, 2, {"reason": "越权"}, 404)
    call("POST", "/reports/" + sent, 1, {"reason": "测试"})
    call("PUT", room + "/membership/leave", 1)
    call("GET", room, 1, status=404)
    call("PUT", room + "/membership/disband")
    assert not call("GET", "/groups")["items"]


def test_recognition_to_map_and_withdrawal(field):
    client, (author, reader, _), staff, _store = field
    species = client.get("/api/v1/species", params={"q": "树麻雀"}).json()["items"][0]["id"]
    point = {"latitude": 39.91471, "longitude": 116.39937, "system": "GCJ-02"}
    buffer = BytesIO()
    exif = Image.Exif()
    exif[272] = "Field Camera"
    Image.new("RGB", (40, 30)).save(buffer, "JPEG", exif=exif)
    media = client.post(
        ROOT + "/media", headers=author, files={"file": ("bird.jpg", buffer.getvalue())}
    ).json()
    assert media["camera"]["model"] == "Field Camera"
    observation = {
        "reference": "photo1",
        "analysis": "analysis1",
        "target": 1,
        "species": species,
        "date": "2026-11-12",
        "time": "09:15",
        "point": point,
        "place": "private site",
        "media": media["id"],
    }
    assert client.post(OBS, headers=reader, json=observation).status_code == 404
    record = client.post(OBS, headers=author, json=observation).json()["id"]
    assert client.post(OBS, headers=author, json=observation).json()["id"] == record
    assert client.get(MAP + "/" + record, headers=reader).status_code == 404
    assert client.get(OBS + "/" + record + "/photo", headers=reader).status_code == 404
    assert client.get(MAP, headers=author).json()["items"][0]["displayLocation"]["latitude"] == 39.91471
    preview = client.post(
        ROOT + "/previews",
        headers=author,
        json={
            "sighting": record,
            "channels": ["map", "post"],
            "share_photo": True,
            "share_date": True,
            "share_camera": True,
        },
    ).json()
    assert preview["display"]["post"]["displayLocation"] is None
    assert preview["display"]["map"]["displayLocation"]["latitude"] == 39.9
    publications = client.post(
        ROOT + "/publications", headers=author, json={"preview": preview["id"]}
    ).json()["items"]
    retry = client.post(ROOT + "/publications", headers=author, json={"preview": preview["id"]}).json()
    assert {row["id"] for row in retry["items"]} == {row["id"] for row in publications}
    assert not client.get(MAP, headers=reader).json()["items"]
    assert not client.get(ROOT + "/posts").json()["items"]
    assert client.get(ROOT + "/moderation", headers=reader).status_code == 403
    for item in publications:
        resource = ROOT + "/publications/" + item["id"]
        assert client.get(resource + "/photo").status_code == 404
        assert client.post(
            ROOT + "/moderation/" + item["id"], headers=staff, json={"status": "approved"}
        ).is_success
        public = client.get(resource, headers=reader).json()
        assert not public["ownedSighting"] and public["memberId"] is None
        assert "private site" not in str(public) and "39.91471" not in str(public)
        assert not Image.open(BytesIO(client.get(public["image"]).content)).getexif()
    post = next(item["id"] for item in publications if item["channel"] == "post")
    pin = next(item["id"] for item in publications if item["channel"] == "map")
    assert client.get(ROOT + "/publications/" + post, headers=reader).json()["related"]["id"] == pin
    assert client.get("/api/v1/species/" + species).json()["records"]
    assert client.put(ROOT + "/publications/" + post + "/bookmark", headers=reader).is_success
    assert client.get(ROOT + "/bookmarks", headers=reader).json()["items"][0]["id"] == post
    reply = client.post(
        ROOT + "/publications/" + post + "/replies",
        headers=reader,
        json={"body": "根据嘴形建议这个种", "species": species, "reference": "r1"},
    ).json()["id"]
    assert client.post(ROOT + "/moderation/" + reply, headers=staff, json={"status": "approved"}).is_success
    assert client.post(OBS + "/" + record + "/adopt", headers=author, json={"reply": reply}).is_success
    assert client.get(ROOT + "/me", headers=author).json()["badges"]
    places = client.get("/api/v1/species/" + species + "/places").json()
    assert (places["placeCount"], places["recordCount"]) == (1, 1)
    assert places["items"][0]["displayLocation"]["latitude"] == 39.9
    assert client.delete(ROOT + "/publications/" + pin, headers=reader).status_code == 404
    assert client.delete(ROOT + "/publications/" + pin, headers=author).is_success
    assert client.get(ROOT + "/publications/" + pin + "/photo").status_code == 404
    assert not client.get(MAP, headers=reader).json()["items"]
    assert client.get(ROOT + "/posts").json()["items"][0]["id"] == post
    assert client.get("/api/v1/species/" + species + "/places").json()["placeCount"] == 0


def test_private_update_invalidates_unused_preview(field):
    client, (author, other, _), _, _store = field
    payload = {"reference": "frame1", "note": "first"}
    route = OBS + "/by-reference/frame1"
    original = client.put(route, headers=author, json=payload).json()["id"]
    preview = client.post(
        ROOT + "/previews", headers=author, json={"sighting": original, "channels": ["post"]}
    ).json()
    payload["note"] = "corrected"
    assert client.put(route, headers=author, json=payload).json()["id"] == original
    assert client.put(route, headers=other, json=payload).json()["id"] != original
    assert (
        client.post(ROOT + "/publications", headers=author, json={"preview": preview["id"]}).status_code
        == 404
    )


def test_direct_messages_and_blocks(field):
    client, (author, reader, other), _, _store = field
    sender, receiver = [client.get(ROOT + "/me", headers=user).json()["id"] for user in (author, reader)]
    path = ROOT + "/messages/" + receiver
    content = {"reference": "dm1", "body": "看到你分享的树麻雀了"}
    message = client.post(path, headers=author, json=content).json()["id"]
    assert client.post(path, headers=author, json=content).json()["id"] == message
    assert client.get(ROOT + "/messages/" + sender, headers=reader).json()["items"][0]["id"] == message
    assert not client.get(path, headers=other).json()["items"]
    assert client.get(ROOT + "/inbox", headers=reader).json()["items"][0]["peer"] == sender
    assert (
        client.post(ROOT + "/reports/" + message, headers=other, json={"reason": "test"}).status_code == 404
    )
    assert client.post(ROOT + "/reports/" + message, headers=reader, json={"reason": "test"}).is_success
    assert client.put(ROOT + "/blocks/" + sender, headers=reader).is_success
    assert client.post(path, headers=author, json={**content, "reference": "dm2"}).status_code == 403
    assert client.delete(ROOT + "/blocks/" + sender, headers=reader).is_success


def test_external_rights_and_withdrawal(field):
    client, _, _, store = field
    record = {
        "datasetKey": DATASET,
        "key": 123,
        "species": "Passer montanus",
        "occurrenceStatus": "DETECTED",
        "license": "https://creativecommons.org/publicdomain/zero/1.0/",
        "coordinateUncertaintyInMeters": 30,
        "eventDate": "2026-11-01",
        "decimalLatitude": 39.91471,
        "decimalLongitude": 116.39937,
    }
    assert (
        snapshot(
            store,
            [
                record,
                {**record, "key": 124, "informationWithheld": "sensitive"},
                {**record, "key": 125, "license": "all rights reserved"},
            ],
        )
        == 1
    )
    item = client.get(ROOT + "/external").json()["items"][0]
    assert item["id"] == "gbif_123" and item["precisionLabel"] == "约一公里公开网格"
    assert snapshot(store, []) == 0 and not client.get(ROOT + "/external").json()["items"]


def test_external_clusters_split_without_losing_records_or_exposing_private_points(field):
    client, (owner, _, _), _, store = field
    record = dict(
        datasetKey="6ff8b3b0-ef0f-4f79-a310-5a5615c6aa0b",
        occurrenceStatus="DETECTED",
        species="Passer montanus",
        eventDate="2026-11-01",
        decimalLatitude=39.9,
        decimalLongitude=116.4,
        license="http://creativecommons.org/licenses/by/4.0/legalcode",
        coordinateUncertaintyInMeters=15,
        recordedBy="Contributor",
    )
    rows = [{**record, "key": key, "decimalLongitude": 116.4 if key < 305 else 116.44} for key in range(310)]
    assert snapshot(store, rows) == 310
    bounds = dict(
        minLatitude=39.7, maxLatitude=40.2, minLongitude=116.1, maxLongitude=116.8, origin="external"
    )

    def clusters(zoom, **filters):
        return client.get(MAP, params={**bounds, "zoom": zoom, **filters}, headers=owner).json()

    broad, fine = clusters(4), clusters(12)
    assert broad["total"] == fine["total"] == 310 and len(broad["clusters"]) == 1
    assert sorted(group["count"] for group in fine["clusters"]) == [5, 305]
    assert clusters(12, scope="mine")["total"] == 0
    page = client.get(ROOT + "/external", params={"limit": 1}).json()
    assert page["hasMore"] and page["items"][0]["source"] == "Birda · GBIF"
    assert page["items"][0]["attribution"] == "Contributor"


def test_incomplete_external_snapshot_is_rejected(monkeypatch):
    from bird_business import import_community

    pages = iter(
        [
            dict(offset=0, count=2, results=[{"key": 1}], endOfRecords=False),
            dict(offset=1, count=2, results=[{"key": 1}], endOfRecords=True),
        ]
    )
    monkeypatch.setattr(import_community, "fetch_page", lambda *_: next(pages))
    with pytest.raises(ValueError, match="incomplete"):
        import_community.collect_rows(DATASET)


def publish_forum(field, owner=None, *, species=None, approved=True):
    client, users, staff, _ = field
    owner = owner or users[0]
    payload = {"title": "一次观察", "body": "树下看到了一只鸟。", "channels": ["post"]}
    if species:
        payload["species"] = species
    preview = client.post(ROOT + "/previews", headers=owner, json=payload)
    assert preview.status_code == 200, preview.text
    response = client.post(ROOT + "/publications", headers=owner, json={"preview": preview.json()["id"]})
    assert response.status_code == 201, response.text
    post = response.json()["items"][0]["id"]
    if approved:
        assert client.post(
            ROOT + "/moderation/" + post, headers=staff, json={"status": "approved"}
        ).is_success
    return post


def test_live_species_search_is_stable_paginated_and_treats_wildcards_as_text(field):
    client, _, _, _ = field
    endpoint = "/api/v1/species"
    pages = [client.get(endpoint, params={"q": "鹤", "limit": 2, "offset": n}).json() for n in (0, 2)]
    assert pages[0]["hasMore"] and pages[0]["offset"] == 0
    ids = [row["id"] for page in pages for row in page["items"]]
    assert len(ids) == len(set(ids)) == 4
    assert client.get(endpoint, params={"q": "鹤", "limit": 4}).json()["items"] == sum(
        [p["items"] for p in pages], []
    )
    exact = client.get(endpoint, params={"q": "喜鹊"}).json()["items"]
    assert exact[0]["name"] == "喜鹊"
    for keyword in ("%", "_", "\\"):
        assert client.get(endpoint, params={"q": keyword}).json()["total"] == 0
    assert client.get(endpoint, params={"q": "  喜鹊  "}).json()["items"] == exact
    assert client.get(endpoint, params={"offset": -1}).status_code == 422


def test_feed_interactions_are_per_viewer_and_only_approved_replies_are_counted(field):
    client, (author, reader, other), staff, _ = field
    post = publish_forum(field)
    hidden = publish_forum(field, approved=False)
    path = ROOT + "/publications/" + post
    for user in (author, reader):
        assert client.put(path + "/like", headers=user).json()["active"]
        assert client.put(path + "/like", headers=user).json()["likes"] == (1 if user == author else 2)
    assert client.put(path + "/bookmark", headers=reader).json()["bookmarked"]
    pending = client.post(
        path + "/replies", headers=reader, json={"body": "待审核回复", "reference": "pending"}
    ).json()["id"]
    approved = client.post(
        path + "/replies", headers=author, json={"body": "公开回复", "reference": "approved"}
    ).json()["id"]
    client.post(ROOT + "/moderation/" + approved, headers=staff, json={"status": "approved"})
    for viewer in (None, author, reader, other):
        listing = client.get(ROOT + "/posts", headers=viewer or {}).json()
        assert listing["total"] == 1 and not listing["hasMore"]
        row = listing["items"][0]
        assert row["id"] == post and row["id"] != hidden
        assert (row["likes"], row["replyCount"]) == (2, 1)
        assert row["bookmarked"] == (viewer == reader)
        assert ("like" in row["reactions"]) == (viewer in (author, reader))
        assert "bookmarks" not in row
        replies = client.get(path, headers=viewer or {}).json()["replies"]
        assert (pending in {r["id"] for r in replies}) == (viewer == reader)
    assert client.delete(path + "/reactions/like", headers=reader).json()["likes"] == 1
    assert client.delete(path + "/reactions/bookmark", headers=reader).json()["bookmarked"] is False


def test_nested_replies_validate_parent_visibility_and_retain_idempotency(field):
    client, (author, reader, other), staff, _ = field
    first = publish_forum(field)
    second = publish_forum(field)
    path = ROOT + "/publications/" + first + "/replies"

    def send(who, body, code=201):
        response = client.post(path, headers=who, json=body)
        assert response.status_code == code, response.text
        return response.json()

    root = send(author, {"body": "第一层", "reference": "root"})["id"]
    child_body = {"body": "第二层", "reference": "child", "parentId": root}
    send(reader, child_body, 404)
    client.post(ROOT + "/moderation/" + root, headers=staff, json={"status": "approved"})
    child = send(reader, child_body)["id"]
    assert send(reader, child_body)["id"] == child
    send(reader, {**child_body, "body": "复用键修改内容"}, 409)
    send(reader, {**child_body, "parentId": None}, 409)
    client.post(ROOT + "/moderation/" + child, headers=staff, json={"status": "approved"})
    grandchild = send(other, {"body": "第三层", "reference": "grandchild", "parentId": child})["id"]
    client.post(ROOT + "/moderation/" + grandchild, headers=staff, json={"status": "approved"})
    crossed = client.post(
        ROOT + "/publications/" + second + "/replies",
        headers=reader,
        json={"body": "不能跨帖引用", "reference": "crossed", "parentId": root},
    )
    assert crossed.status_code == 404
    replies = client.get(path.removesuffix("/replies"), headers=author).json()["replies"]
    indexed = {row["id"]: row for row in replies}
    assert indexed[root]["parentId"] is None
    assert indexed[child]["parentId"] == root and indexed[grandchild]["parentId"] == child
    assert indexed[child]["replyToName"] and indexed[grandchild]["publicName"]
    client.post(ROOT + "/moderation/" + root, headers=staff, json={"status": "rejected"})
    replies = client.get(path.removesuffix("/replies")).json()["replies"]
    assert root not in {row["id"] for row in replies}
    assert next(row for row in replies if row["id"] == child)["replyToName"] == ""
    send(other, {"body": "不可回复已隐藏楼层", "reference": "hidden", "parentId": root}, 404)


def test_species_discussion_topic_is_explicit_and_cannot_override_observations_or_sources(field):
    client, (author, _, _), _, _ = field
    species = client.get("/api/v1/species", params={"q": "树麻雀"}).json()["items"][0]["id"]
    post = publish_forum(field, species=species)
    assert client.get(ROOT + "/posts", params={"species": species}).json()["items"][0]["id"] == post
    assert client.get("/api/v1/species/" + species).json()["features"]["speciesPosts"]
    for overrides in ({"channels": ["map"]}, {"external": "gbif_1"}, {"sighting": "obs_unknown"}):
        response = client.post(
            ROOT + "/previews",
            headers=author,
            json={"body": "话题", "channels": ["post"], "species": species, **overrides},
        )
        assert response.status_code == 422
    assert (
        client.post(
            ROOT + "/previews",
            headers=author,
            json={"body": "无效鸟种", "channels": ["post"], "species": "missing"},
        ).status_code
        == 404
    )


def test_reply_parent_migration_preserves_the_old_database_and_reopens_idempotently(tmp_path):
    import sqlite3

    from bird_business.community_store import CommunityStore

    database = tmp_path / "old.sqlite"
    with sqlite3.connect(database) as db:
        db.execute(
            "CREATE TABLE replies(id TEXT PRIMARY KEY,post TEXT NOT NULL,owner TEXT NOT NULL,body TEXT,"
            "species TEXT,status TEXT NOT NULL,created TEXT NOT NULL,ref TEXT NOT NULL,UNIQUE(owner,ref))"
        )
        db.execute(
            "INSERT INTO replies VALUES(?,?,?,?,?,?,?,?)",
            ("old", "post", "owner", "原回复", None, "approved", "2026-11-01", "retry"),
        )
    catalog = BusinessSettings().catalog_path
    for _ in range(2):
        store = CommunityStore(database, catalog)
        with store.transaction() as db:
            row = dict(db.execute("SELECT * FROM replies WHERE id='old'").fetchone())
            assert row["body"] == "原回复" and row["status"] == "approved" and row["parent"] is None
            assert len(list(db.execute("PRAGMA table_info(replies)"))) == 9
        store.db.close()


def test_reply_pagination_is_bounded_without_leaking_another_readers_pending_reply(field):
    client, (author, reader, other), _, store = field
    post = publish_forum(field)
    owner = client.get(ROOT + "/me", headers=author).json()["id"]
    with store.transaction() as db:
        db.executemany(
            "INSERT INTO replies(id,post,owner,body,status,created,ref,parent) VALUES(?,?,?,?,?,?,?,?)",
            [
                (f"page_{i:03}", post, owner, "公开回复", "approved", "2026-11-25", f"page_{i}", None)
                for i in range(102)
            ],
        )
    pending = client.post(
        ROOT + "/publications/" + post + "/replies",
        headers=reader,
        json={"body": "仅作者可见", "reference": "private-pending"},
    ).json()["id"]
    path = ROOT + "/publications/" + post
    for user, expected in ((reader, 103), (other, 102)):
        first = client.get(path, headers=user).json()
        second = client.get(path, headers=user, params={"replyOffset": 100}).json()
        assert first["replyHasMore"] and not second["replyHasMore"]
        rows = first["replies"] + second["replies"]
        assert len({row["id"] for row in rows}) == expected
        assert (pending in {row["id"] for row in rows}) == (user == reader)
        assert first["replyCount"] == second["replyCount"] == 102
    assert client.get(path, params={"replyOffset": -1}).status_code == 422


def test_species_places_sort_globally_before_pagination_and_use_date_within_distance(field):
    import json

    client, _, _, database = field
    species = "avibase-C22FBF8D"
    with database.transaction() as db:
        for index, (lat, day) in enumerate(
            [(40.2, "2026-11-24"), (40.0, "2026-10-01"), (40.1, "2026-11-23")]
        ):
            db.execute(
                "INSERT INTO publications(id,owner,channel,status,display,species,lat,lon,day,created) "
                "VALUES(?, 'gbif','map','approved',?,?,?,116.3,?,?)",
                (
                    f"sort-{index}",
                    json.dumps({"placeName": "Beijing"}),
                    species,
                    lat,
                    day,
                    f"2026-11-25T00:00:0{index}Z",
                ),
            )
    route = f"/api/v1/species/{species}/places"
    point = {"latitude": 40, "longitude": 116.3}
    near = [
        client.get(route, params={**point, "sort": "distance", "limit": 1, "offset": offset}).json()["items"][
            0
        ]
        for offset in range(3)
    ]
    assert [row["displayLocation"]["latitude"] for row in near] == [40.0, 40.1, 40.2]
    assert near[0]["km"] == 0
    recent = client.get(route, params={**point, "sort": "recent"}).json()
    assert [row["latest"] for row in recent["items"]] == ["2026-11-24", "2026-11-23", "2026-10-01"]
    assert recent["sort"] == "recent" and recent["recordCount"] == 3
    assert client.get(route, params={"sort": "distance"}).status_code == 422
    assert client.get(route, params={"latitude": 40}).status_code == 422


def test_observation_date_cursor_is_stable_and_cannot_be_used_for_collection_order(field):
    import json

    client, (owner, _, _), _, database = field
    species = "avibase-C22FBF8D"
    with database.transaction() as db:
        for index, day in enumerate(["2026-11-01", "2026-10-01", "2026-11-01", ""]):
            db.execute(
                "INSERT INTO publications(id,owner,channel,status,display,species,lat,lon,day,created) "
                "VALUES(?, 'gbif','map','approved',?,?,40,116.3,?,?)",
                (
                    f"date-{index}",
                    json.dumps({"placeName": "Beijing", "speciesName": "麻雀"}),
                    species,
                    day,
                    f"2026-11-25T00:00:0{index}Z",
                ),
            )
    items, cursor = [], ""
    for _ in range(4):
        result = client.get(
            MAP, headers=owner, params={"sort": "recent", "limit": 1, "cursor": cursor}
        ).json()
        items.extend(result["items"])
        cursor = result["nextCursor"]
        assert result["sort"] == "recent"
    assert [row["id"] for row in items] == ["date-2", "date-0", "date-1", "date-3"]
    assert not cursor
    first = client.get(MAP, headers=owner, params={"sort": "recent", "limit": 1}).json()
    assert client.get(MAP, headers=owner, params={"cursor": first["nextCursor"]}).status_code == 422


def test_map_clusters_distinguish_the_owners_private_records_without_exposing_them_to_others(field):
    client, (author, reader, _), _staff, store = field
    row = dict(
        key=76001,
        datasetKey="6ff8b3b0-ef0f-4f79-a310-5a5615c6aa0b",
        occurrenceStatus="DETECTED",
        species="Passer montanus",
        eventDate="2026-11-01",
        decimalLatitude=39.9,
        decimalLongitude=116.4,
        license="http://creativecommons.org/licenses/by/4.0/legalcode",
        coordinateUncertaintyInMeters=15,
        recordedBy="Contributor",
    )
    assert snapshot(store, [row]) == 1
    species = client.get("/api/v1/species", params={"q": "树麻雀"}).json()["items"][0]["id"]
    photo = BytesIO()
    Image.new("RGB", (40, 30), "green").save(photo, "JPEG")
    media = client.post(
        ROOT + "/media", headers=author, files={"file": ("bird.jpg", photo.getvalue())}
    ).json()["id"]
    response = client.post(
        OBS,
        headers=author,
        json={
            "reference": "private-cluster",
            "analysis": "analysis-private",
            "target": 1,
            "species": species,
            "date": "2026-11-28",
            "time": "07:30",
            "point": {"latitude": 39.9, "longitude": 116.4, "system": "GCJ-02"},
            "place": "private location",
            "media": media,
        },
    )
    assert response.status_code == 201
    own = client.get(MAP, params={"zoom": 3}, headers=author).json()
    other = client.get(MAP, params={"zoom": 3}, headers=reader).json()
    assert own["total"] == 2
    assert sorted((group["visibility"], group["count"]) for group in own["clusters"]) == [
        ("private", 1),
        ("public", 1),
    ]
    assert other["total"] == 1
    assert all(group["visibility"] == "public" for group in other["clusters"])
