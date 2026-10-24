from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(slots=True)
class ServiceError(Exception):
    code: str
    message: str
    status_code: int = 400
    details: dict[str, Any] | None = None

    def __str__(self) -> str:
        return self.message


class NotReadyError(ServiceError):
    def __init__(self, message: str = "inference service is not ready") -> None:
        super().__init__("SERVICE_NOT_READY", message, 503)


class SessionNotFoundError(ServiceError):
    def __init__(self, session_id: str) -> None:
        super().__init__(
            "SESSION_NOT_FOUND",
            "vision session does not exist",
            404,
            {"session_id": session_id},
        )
