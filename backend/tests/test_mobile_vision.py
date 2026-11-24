from io import BytesIO

from fastapi.testclient import TestClient

from bird_common import mobile_auth
from bird_vision.app import create_app


def test_wechat_tickets_scope_ownership_and_expiry(test_settings, jpeg_bytes, monkeypatch):
    settings = test_settings.model_copy(update={
        "allow_anonymous": False, "api_keys": "private-key",
        "wechat_app_id": "test-id", "wechat_app_secret": "test-secret",
    })
    with TestClient(create_app(settings)) as client:
        monkeypatch.setattr(mobile_auth, "urlopen", lambda *args, **kwargs: BytesIO(b'{"openid":"alice"}'))
        response = client.post("/api/v1/vision/auth/wechat", json={"code": "a-code"})
        assert response.status_code == 200 and response.headers["cache-control"] == "no-store"
        token = response.json()["access_token"]
        alice = {"Authorization": "Bearer " + token}
        bob = {"Authorization": "Bearer " + client.app.state.auth.issue("wx:test-id:bob")}
        sessions = "/api/v1/vision/sessions"
        session = client.post(sessions, headers=alice, json={}).json()
        path = sessions + "/" + session["session_id"]
        assert client.get(path, headers=bob).status_code == 404
        assert client.get(path, headers=alice).status_code == 200
        assert client.get("/metrics", headers=alice).status_code == 403
        with client.websocket_connect(session["websocket_path"], headers=alice) as ws:
            assert ws.receive_json()["type"] == "vision.session.started"
        photo = client.post(
            "/api/v1/vision/analyses", headers=alice, files={"image": ("a.jpg", jpeg_bytes, "image/jpeg")},
            data={"observation_mode": "historical", "captured_at": "1970-01-01T00:00:00Z"},
        )
        assert photo.status_code == 200
        assert set(photo.json()["model"]["details"]) == {"revision", "catalog_version"}
        assert client.delete(path, headers=alice).status_code == 204
        tampered = {"Authorization": "Bearer " + token.replace(token.split(".")[1], "f" * 32)}
        assert client.post(sessions, headers=tampered, json={}).status_code == 401
        monkeypatch.setattr(mobile_auth.time, "time", lambda: int(token.split(".")[2]) + 1)
        assert client.post(sessions, headers=alice, json={}).status_code == 401


def test_no_mobile_login_without_server_configuration(test_settings):
    with TestClient(create_app(test_settings)) as client:
        assert client.post("/api/v1/vision/auth/wechat", json={"code": "unused"}).status_code == 503


def test_course_business_login_works_on_separate_gpu(business_settings, test_settings, monkeypatch):
    from bird_business.app import create_app as create_business

    common = {"allow_anonymous": False, "mobile_signing_key": "ba" * 32}
    server = business_settings.model_copy(update={**common, "api_keys": "business-only",
                                                  "wechat_app_id": "test-id", "wechat_app_secret": "test"})
    gpu = test_settings.model_copy(update={**common, "api_keys": "gpu-only"})
    monkeypatch.setattr(mobile_auth, "urlopen", lambda *args, **kwargs: BytesIO(b'{"openid":"alice"}'))
    with TestClient(create_business(server)) as business, TestClient(create_app(gpu)) as worker:
        reply = business.post("/api/v1/vision/auth/wechat", json={"code": "code"})
        assert reply.status_code == 200
        headers = {"Authorization": "Bearer " + reply.json()["access_token"]}
        assert business.get("/api/v1/observations", headers=headers).status_code == 200
        assert business.get("/metrics", headers=headers).status_code == 403
        assert worker.post("/api/v1/vision/sessions", json={}, headers=headers).status_code == 201
        rejected = worker.post("/api/v1/vision/sessions", json={}, headers={"X-API-Key": "business-only"})
        assert rejected.status_code == 401
