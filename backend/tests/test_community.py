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
    assert item["id"] == "gbif_123" and item["displayLocation"]["latitude"] == 39.9
    assert snapshot(store, []) == 0 and not client.get(ROOT + "/external").json()["items"]
