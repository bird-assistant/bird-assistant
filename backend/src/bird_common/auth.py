from __future__ import annotations

import hmac
from dataclasses import dataclass
from hashlib import sha256
from typing import Any

from fastapi import Request, WebSocket

from bird_common.errors import ServiceError


@dataclass(frozen=True, slots=True)
class Principal:
    subject: str


class ApiKeyAuth:
    """Server-side credential check shared by every service.

    Settings are duck-typed (``allow_anonymous`` and ``api_key_set``) so each
    service keeps its own environment prefix while sharing the credential rules.
    """

    def __init__(self, settings: Any) -> None:
        self.settings = settings

    def _verify(self, provided: str | None) -> Principal:
        if self.settings.allow_anonymous:
            return Principal("anonymous")
        if not provided:
            raise ServiceError("AUTH_REQUIRED", "missing API credential", 401)
        for configured in self.settings.api_key_set:
            if hmac.compare_digest(configured, provided):
                fingerprint = sha256(configured.encode("utf-8")).hexdigest()[:16]
                return Principal(f"api-key:{fingerprint}")
        raise ServiceError("AUTH_INVALID", "invalid API credential", 401)

    @staticmethod
    def _bearer(authorization: str | None) -> str | None:
        if not authorization:
            return None
        scheme, _, token = authorization.partition(" ")
        if scheme.casefold() != "bearer" or not token:
            return None
        return token.strip()

    def verify_request(self, request: Request) -> Principal:
        token = self._bearer(request.headers.get("authorization")) or request.headers.get("x-api-key")
        return self._verify(token)

    def verify_websocket(self, websocket: WebSocket) -> Principal:
        token = (
            self._bearer(websocket.headers.get("authorization"))
            or websocket.headers.get("x-api-key")
            or websocket.query_params.get("access_token")
        )
        return self._verify(token)


async def require_principal(request: Request) -> Principal:
    return request.app.state.auth.verify_request(request)
