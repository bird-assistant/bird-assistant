import hashlib
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from bird_business.app import create_app
from bird_business.config import BusinessSettings

ROOT = "/api/v1/community"
ORIGIN = "https://testserver"


@pytest.fixture
def console(tmp_path):
    settings = BusinessSettings(
        database_path=tmp_path / "review.sqlite",
        api_keys="staff-key",
        allow_anonymous=False,
        mobile_signing_key="a" * 64,
        admin_password_sha256=hashlib.sha256(b"test-review-password").hexdigest(),
    )
    app = create_app(settings)
    with TestClient(app, base_url=ORIGIN) as client:
        yield client, {"Authorization": "Bearer " + app.state.auth.issue("writer")}


def sign_in(client):
    result = client.post(
        "/admin/login",
        headers={"Origin": ORIGIN},
        json={"username": "admin", "password": "test-review-password"},
    )
    assert result.status_code == 200
    cookie = result.headers["set-cookie"].lower()
    assert all(flag in cookie for flag in ("httponly", "secure", "samesite=strict", "path=/admin"))
    return {"Origin": ORIGIN, "X-Review-CSRF": result.json()["csrf"]}


def test_login_controls_and_logout(console):
    client, member = console
    assert client.get("/admin/").status_code == 200
    assert client.get("/admin/assets/console.js").is_success
    assert client.get("/admin/queue", headers=member).status_code == 401
    assert client.get("/admin/photos/post_test", headers={"X-API-Key": "staff-key"}).status_code == 401
    headers = sign_in(client)
    assert client.get("/admin/session").json()["csrf"] == headers["X-Review-CSRF"]
    assert client.post("/admin/logout", headers={"Origin": ORIGIN}).status_code == 403
    assert (
        client.post("/admin/logout", headers={**headers, "Origin": "https://elsewhere.test"}).status_code
        == 403
    )
    assert client.post("/admin/logout", headers=headers).is_success
    assert client.get("/admin/queue").status_code == 401
    for _ in range(8):
        assert (
            client.post(
                "/admin/login", headers={"Origin": ORIGIN}, json={"username": "admin", "password": "wrong"}
            ).status_code
            == 401
        )
    assert (
        client.post(
            "/admin/login", headers={"Origin": ORIGIN}, json={"username": "admin", "password": "wrong"}
        ).status_code
        == 429
    )


def test_review_publication_reply_photo_and_report(console):
    client, member = console
    buffer = BytesIO()
    Image.new("RGB", (12, 12)).save(buffer, "JPEG")
    media = client.post(
        ROOT + "/media", headers=member, files={"file": ("field.jpg", buffer.getvalue())}
    ).json()["id"]
    preview = client.post(
        ROOT + "/previews",
        headers=member,
        json={
            "title": "林中观察",
            "body": "观察笔记",
            "media": media,
            "share_photo": True,
            "channels": ["post"],
        },
    ).json()["id"]
    record = client.post(ROOT + "/publications", headers=member, json={"preview": preview}).json()["items"][
        0
    ]["id"]
    headers = sign_in(client)

    def action(kind, target, status):
        return client.post(f"/admin/actions/{kind}/{target}", headers=headers, json={"status": status})

    queue = client.get("/admin/queue").json()
    assert queue["items"][0]["id"] == record and queue["items"][0]["photo"]
    assert client.get("/admin/photos/" + record).headers["content-type"] == "image/jpeg"
    assert not client.get(ROOT + "/posts").json()["items"]
    assert action("pending", record, "approved").is_success
    assert action("pending", record, "rejected").status_code == 409
    assert client.get("/admin/photos/" + record).status_code == 404
    assert client.get(ROOT + "/posts").json()["items"][0]["id"] == record
    reply = client.post(
        ROOT + "/publications/" + record + "/replies",
        headers=member,
        json={"reference": "my-reply", "body": "发现一只"},
    ).json()["id"]
    assert client.get("/admin/queue?tab=reply").json()["items"][0]["id"] == reply
    assert action("pending", reply, "rejected").is_success
    for decision in ("approved", "rejected"):
        assert client.post(
            ROOT + "/reports/" + record, headers=member, json={"reason": "复核照片"}
        ).is_success
        assert client.get("/admin/queue?tab=reports").json()["items"][0]["reasons"] == ["复核照片"]
        assert action("report", record, decision).is_success
        assert not client.get("/admin/queue?tab=reports").json()["items"]
    assert not client.get(ROOT + "/posts").json()["items"]
    assert client.get("/admin/queue?tab=history").json()["items"][0]["status"] == "report_removed"
