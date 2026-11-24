from __future__ import annotations

import secrets

from bird_common.mobile_auth import MobileAuth
from bird_common.mobile_auth import router as router
from bird_vision.config import Settings


class VisionAuth(MobileAuth):
    def __init__(self, settings: Settings) -> None:
        super().__init__(settings, ("/api/v1/vision/analyses", "/api/v1/vision/sessions"))


if __name__ == "__main__":
    print(VisionAuth(Settings()).issue("devtools:" + secrets.token_hex(16)))
