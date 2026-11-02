from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest
from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient

from bird_common.app_factory import build_service_app
from bird_common.auth import ApiKeyAuth, Principal
from bird_common.catalog import load_catalog, optional_text, parse_bool, parse_regions, sha256_file
from bird_common.errors import ServiceError
from bird_common.logging import JsonFormatter, configure_logging

CATALOG_HEADER = (
    "species_id,scientific_name,common_name_zh,common_name_en,order,family,enabled,"
    "taxon_source,taxon_version,license\n"
)


@asynccontextmanager
async def _lifespan(app: FastAPI):
    yield


def mini_app(*, cors_origins: str = "") -> FastAPI:
    router = APIRouter()

    @router.get("/boom")
    async def boom() -> dict:
        raise ServiceError("TOO_BUSY", "try later", 429, {"limit": 1})

    @router.get("/broken")
    async def broken() -> dict:
        raise RuntimeError("kaboom")

    @router.post("/echo")
    async def echo(payload: dict) -> dict:
        return payload

    @router.get("/identity")
    async def identity() -> dict:
        return {"ok": True}

    settings = SimpleNamespace(log_level="INFO", cors_origin_list=[cors_origins] if cors_origins else [])
    return build_service_app(
        settings=settings,
        router=router,
        lifespan=_lifespan,
        title="Mini API",
        description="test only",
        version="0.0.1",
    )


def test_request_id_is_generated_and_echoed() -> None:
    with TestClient(mini_app()) as client:
        generated = client.get("/identity")
        assert generated.headers["X-Request-ID"].startswith("req_")
        echoed = client.get("/identity", headers={"X-Request-ID": "trace-1"})
        assert echoed.headers["X-Request-ID"] == "trace-1"
        rejected = client.get("/identity", headers={"X-Request-ID": "bad id"})
        assert rejected.headers["X-Request-ID"].startswith("req_")


def test_service_error_envelope_and_retry_after() -> None:
    with TestClient(mini_app()) as client:
        response = client.get("/boom")
    assert response.status_code == 429
    body = response.json()["error"]
    assert body["code"] == "TOO_BUSY"
    assert body["details"] == {"limit": 1}
    assert body["request_id"].startswith("req_")
    assert response.headers["Retry-After"] == "1"


def test_validation_errors_do_not_echo_the_body() -> None:
    with TestClient(mini_app()) as client:
        response = client.post("/echo", json=["not", "an", "object"])
    assert response.status_code == 422
    body = response.json()["error"]
    assert body["code"] == "VALIDATION_ERROR"
    assert isinstance(body["details"], list)
    assert "loc" in body["details"][0]


def test_unexpected_errors_return_the_internal_envelope() -> None:
    with TestClient(mini_app(), raise_server_exceptions=False) as client:
        response = client.get("/broken")
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "INTERNAL_ERROR"


def test_cors_headers_are_applied_when_configured() -> None:
    with TestClient(mini_app(cors_origins="https://wx.test")) as client:
        response = client.options(
            "/identity",
            headers={
                "Origin": "https://wx.test",
                "Access-Control-Request-Method": "GET",
            },
        )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://wx.test"


def test_api_key_auth_paths() -> None:
    settings = SimpleNamespace(allow_anonymous=False, api_key_set=frozenset({"secret"}))
    auth = ApiKeyAuth(settings)
    request = SimpleNamespace(headers={"x-api-key": "secret"})
    principal = auth.verify_request(request)
    assert isinstance(principal, Principal)
    assert principal.subject.startswith("api-key:")
    assert len(principal.subject) == len("api-key:") + 16
    bearer = auth.verify_request(SimpleNamespace(headers={"authorization": "Bearer secret"}))
    assert bearer == principal
    with pytest.raises(ServiceError) as missing:
        auth.verify_request(SimpleNamespace(headers={}))
    assert missing.value.code == "AUTH_REQUIRED"
    with pytest.raises(ServiceError) as wrong:
        auth.verify_request(SimpleNamespace(headers={"authorization": "Basic nope"}))
    assert wrong.value.code == "AUTH_REQUIRED"
    with pytest.raises(ServiceError) as invalid:
        auth.verify_request(SimpleNamespace(headers={"x-api-key": "other"}))
    assert invalid.value.code == "AUTH_INVALID"
    anonymous = ApiKeyAuth(SimpleNamespace(allow_anonymous=True, api_key_set=frozenset()))
    assert anonymous.verify_request(SimpleNamespace(headers={})).subject == "anonymous"


def test_json_formatter_includes_extras_and_exceptions() -> None:
    formatter = JsonFormatter()
    record = logging.LogRecord("test", logging.INFO, __file__, 1, "hello", None, None)
    record.request_id = "req_1"
    record.analysis_id = "aud_1"
    payload = json.loads(formatter.format(record))
    assert payload["message"] == "hello"
    assert payload["request_id"] == "req_1"
    assert payload["analysis_id"] == "aud_1"
    try:
        raise ValueError("boom")
    except ValueError:
        record.exc_info = __import__("sys").exc_info()
    payload = json.loads(formatter.format(record))
    assert "ValueError" in payload["exception"]


def test_configure_logging_is_idempotent() -> None:
    configure_logging("WARNING")
    configure_logging("INFO")
    assert logging.getLogger().level == logging.INFO
    assert all(isinstance(handler.formatter, JsonFormatter) for handler in logging.getLogger().handlers)


def test_catalog_helpers() -> None:
    assert optional_text("  x ") == "x"
    assert optional_text("   ") is None
    assert parse_bool("yes") is True
    assert parse_bool("0") is False
    assert parse_bool(None) is True
    assert parse_regions("cn; US ;") == frozenset({"CN", "US"})
    with pytest.raises(ValueError):
        parse_bool("maybe")


def test_load_catalog_reads_rows(tmp_path) -> None:
    path = tmp_path / "catalog.csv"
    path.write_text(
        CATALOG_HEADER
        + "id1,Turdus merula,乌鸫,Eurasian Blackbird,Passeriformes,Turdidae,true,AviList,v2026,CC BY 4.0\n"
        + "id2,Parus major,,Great Tit,Passeriformes,Paridae,false,AviList,v2026,CC BY 4.0\n",
        encoding="utf-8",
    )
    taxa = load_catalog(path)
    assert [taxon.species_id for taxon in taxa] == ["id1", "id2"]
    assert taxa[0].common_name_zh == "乌鸫"
    assert taxa[1].enabled is False
    assert taxa[0].taxon_version == "v2026"
    assert len(sha256_file(path)) == 64


def test_load_catalog_rejects_bad_files(tmp_path) -> None:
    missing_columns = tmp_path / "bad.csv"
    missing_columns.write_text("species_id\nid1\n", encoding="utf-8")
    with pytest.raises(ValueError, match="missing columns"):
        load_catalog(missing_columns)

    duplicate = tmp_path / "dupe.csv"
    duplicate.write_text(
        CATALOG_HEADER + "id1,Turdus merula,,,,,true,,,\n" + "id1,Parus major,,,,,true,,,\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="duplicate species_id"):
        load_catalog(duplicate)

    duplicate_name = tmp_path / "dupe_name.csv"
    duplicate_name.write_text(
        CATALOG_HEADER + "id1,Turdus merula,,,,,true,,,\n" + "id2,Turdus merula,,,,,true,,,\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="duplicate scientific_name"):
        load_catalog(duplicate_name)

    empty = tmp_path / "empty.csv"
    empty.write_text(CATALOG_HEADER, encoding="utf-8")
    with pytest.raises(ValueError, match="empty"):
        load_catalog(empty)

    bad_bool = tmp_path / "bad_bool.csv"
    bad_bool.write_text(CATALOG_HEADER + "id1,Turdus merula,,,,,maybe,,,\n", encoding="utf-8")
    with pytest.raises(ValueError, match="invalid boolean"):
        load_catalog(bad_bool)

    with pytest.raises(FileNotFoundError):
        load_catalog(tmp_path / "nope.csv")
