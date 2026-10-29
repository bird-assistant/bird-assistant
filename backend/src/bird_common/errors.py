from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(slots=True)
class ServiceError(Exception):
    """A failure that maps to the documented error envelope.

    Every service returns the same ``{"error": {"code", "message",
    "request_id", "details"}}`` body, so callers only need one error contract.
    """

    code: str
    message: str
    status_code: int = 400
    details: dict[str, Any] | None = None

    def __str__(self) -> str:
        return self.message
