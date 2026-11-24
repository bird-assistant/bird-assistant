import json
from datetime import datetime, timedelta
from io import BytesIO
from urllib.error import HTTPError

import pytest
from fastapi.testclient import TestClient

from bird_business import trip_harness
from bird_business.app import create_app
from bird_business.config import BusinessSettings
from bird_business.trip_advice import BEIJING
from bird_common.errors import ServiceError

ROUTE = "/api/v1/map/trip-plan"


@pytest.fixture
def advisor(tmp_path, monkeypatch):
    settings = BusinessSettings(
        database_path=tmp_path / "harness.sqlite",
        mobile_signing_key="1" * 64,
        trip_api_key="test-offline",
        allow_anonymous=False,
    )
    unavailable = {"available": False, "hours": [], "source": "MET Norway"}
    monkeypatch.setattr("bird_business.trip_evidence.weather_at", lambda *_: unavailable)
    with TestClient(create_app(settings)) as client:
        tokens = [
            {"Authorization": "Bearer " + client.app.state.auth.issue(subject)}
            for subject in ("user-a", "user-b")
        ]
        body = {
            "latitude": 39.9137,
            "longitude": 116.4128,
            "hours": 2,
            "radius": 30,
            "startHour": 7,
            "date": (datetime.now(BEIJING).date() + timedelta(days=1)).isoformat(),
            "question": "带孩子去公园，如何安排？",
            "requestId": "question-001",
        }
        yield client, tokens, body


def final(**changes):
    plan = {
        "answer": "可以从附近公园开始。目前没有对应时段的预报，出门前再查一次。",
        "destinations": ["P1"],
        "sources": ["P1", "W0"],
        "stages": [{"offsetMinutes": 10, "action": "在步道上安静观察"}],
    }
    return {"content": json.dumps({**plan, **changes}), "usage": {"total_tokens": 42}}


def test_chat_tools_followup_idempotency_and_owner(advisor, monkeypatch):
    client, (owner, other), body = advisor
    requests = []

    def chat(settings, payload, timeout):
        requests.append(json.loads(json.dumps(payload)))
        if len(requests) == 1:
            assert "39.9137" not in str(payload) and "test-offline" not in str(payload)
            return {
                "tool_calls": [
                    {
                        "id": "call-1",
                        "function": {
                            "name": "get_species_guide",
                            "arguments": json.dumps({"name": "树麻雀"}),
                        },
                    }
                ]
            }
        if len(requests) == 2:
            assert json.loads(payload["messages"][-1]["content"])["matches"][0]["name"]
            return final(sources=["G1", "P1", "W0"])
        assert any(msg["role"] == "assistant" and "附近公园" in msg["content"] for msg in payload["messages"])
        return final()

    monkeypatch.setattr(trip_harness, "cloud_chat", chat)
    result = client.post(ROUTE, headers=owner, json=body).json()
    assert result["engine"] == "dashscope" and result["trace"]["tools"] == 1 and result["trace"]["calls"] == 2
    assert result["guideCards"][0]["id"] and result["weatherCards"][0]["available"] is False
    assert client.post(ROUTE, headers=owner, json=body).json() == result and len(requests) == 2
    assert client.post(ROUTE, headers=owner, json={**body, "hours": 3}).status_code == 409
    followup = {**body, "requestId": "question-002", "question": "如果下雨呢？", "parentTurn": result["turn"]}
    assert client.post(ROUTE, headers=other, json=followup).status_code == 410
    assert client.post(ROUTE, headers=owner, json=followup).is_success and len(requests) == 3


def test_validation_repair_and_no_fabricated_fallback(advisor, monkeypatch):
    client, (owner, _), body = advisor
    messages = [
        final(destinations=["P99"]),
        final(),
    ]
    monkeypatch.setattr(trip_harness, "cloud_chat", lambda *_: messages.pop(0))
    assert client.post(ROUTE, headers=owner, json=body).json()["trace"]["calls"] == 2
    monkeypatch.setattr(trip_harness, "cloud_chat", lambda *_: final(sources=["G99"]))
    failure = client.post(ROUTE, headers=owner, json={**body, "requestId": "question-002"})
    assert failure.status_code == 502 and failure.json()["error"]["code"] == "TRIP_OUTPUT"
    monkeypatch.setattr(trip_harness, "cloud_chat", lambda *_: final())
    assert client.post(ROUTE, headers=owner, json={**body, "requestId": "question-002"}).is_success


def test_auth_cost_limits_and_unconfigured(advisor, monkeypatch):
    client, (owner, _), body = advisor
    assert client.post(ROUTE, json=body).status_code == 401
    monkeypatch.setattr(trip_harness, "cloud_chat", lambda *_: final())
    settings = client.app.state.settings
    monkeypatch.setattr(settings, "trip_global_hourly", 1)
    assert client.post(ROUTE, headers=owner, json=body).is_success
    assert client.post(ROUTE, headers=owner, json={**body, "requestId": "question-002"}).status_code == 429
    monkeypatch.setattr(settings, "trip_api_key", type(settings.trip_api_key)(""))
    assert (
        client.post(ROUTE, headers=owner, json={**body, "requestId": "question-003"}).json()["error"]["code"]
        == "TRIP_NOT_CONFIGURED"
    )
    assert client.post(ROUTE, headers=owner, json={**body, "date": "2020-01-01"}).status_code == 422


def test_wire_protocol_two_tool_rounds_then_json(advisor, monkeypatch):
    client, (owner, _), body = advisor
    sent = []

    class Transport:
        def open(self, request, timeout):
            payload = json.loads(request.data)
            sent.append(payload)
            assert request.full_url == trip_harness.ENDPOINT and payload["model"] == "qwen-plus"
            assert request.get_header("Authorization") == "Bearer test-offline"
            assert 0 < timeout <= 32
            if len(sent) < 3:
                if len(sent) == 2:
                    assert json.loads(payload["messages"][-1]["content"])["area"]
                name, args = (
                    ("get_forecast", {"area": "P1"})
                    if len(sent) == 1
                    else ("get_species_guide", {"name": "树麻雀"})
                )
                message = {
                    "tool_calls": [
                        {
                            "id": "call" + str(len(sent)),
                            "function": {"name": name, "arguments": json.dumps(args)},
                        }
                    ]
                }
                reason = "tool_calls"
            else:
                assert payload["response_format"] == {"type": "json_object"} and "tools" not in payload
                assert payload["messages"][-1]["tool_call_id"] == "call2"
                message = final(sources=["W1", "P1", "G1"])
                reason = "stop"
            return BytesIO(
                json.dumps(
                    {
                        "usage": {"total_tokens": 10},
                        "choices": [{"message": message, "finish_reason": reason}],
                    }
                ).encode()
            )

    monkeypatch.setattr(trip_harness, "build_opener", lambda *_: Transport())
    plan = client.post(ROUTE, headers=owner, json=body).json()
    assert len(plan["weatherCards"]) == 2 and plan["guideCards"] and plan["trace"]["tokens"] == 30
    assert plan["trace"]["calls"] == 3 and plan["trace"]["tools"] == 2


def test_protected_species_and_empty_weather(advisor, monkeypatch):
    client, (owner, _), body = advisor
    with client.app.state.community.transaction() as db:
        species = db.execute("SELECT id FROM taxa WHERE sensitive=1 LIMIT 1").fetchone()[0]

    def chat(settings, payload, timeout):
        initial = json.loads(payload["messages"][-1]["content"])
        assert initial["request"]["protectedSpecies"]
        assert initial["evidence"]["F0"] == {"areas": [], "parks": []}
        assert not initial["evidence"]["W0"]["available"]
        return final(destinations=[], sources=["F0", "W0"], stages=[])

    monkeypatch.setattr(trip_harness, "cloud_chat", chat)
    response = client.post(ROUTE, headers=owner, json={**body, "species": species})
    assert response.is_success and not response.json()["stops"] and not response.json()["parks"]


@pytest.mark.parametrize(
    ("status", "code"), [(401, "TRIP_PROVIDER_AUTH"), (429, "TRIP_PROVIDER_BUSY"), (500, "TRIP_PROVIDER")]
)
def test_provider_errors_are_sanitized(status, code, monkeypatch):
    class Upstream:
        def open(self, request, timeout):
            assert request.full_url == trip_harness.ENDPOINT
            raise HTTPError(request.full_url, status, "secret-provider-message", {}, BytesIO())

    monkeypatch.setattr(trip_harness, "build_opener", lambda *_: Upstream())
    with pytest.raises(ServiceError) as error:
        trip_harness.cloud_chat(BusinessSettings(trip_api_key="test-only"), {"messages": []}, 3)
    assert error.value.code == code and "secret-provider" not in str(error.value)
