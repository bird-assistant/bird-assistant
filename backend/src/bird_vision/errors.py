from __future__ import annotations

from bird_common.errors import ServiceError

__all__ = ["NotReadyError", "ServiceError", "SessionNotFoundError"]


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
