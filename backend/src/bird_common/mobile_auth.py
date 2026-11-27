from __future__ import annotations

import hashlib
import hmac
import json
import re
import time
from typing import Protocol
from urllib.parse import urlencode
from urllib.request import urlopen

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field

from bird_common.auth import ApiKeyAuth, Principal
from bird_common.errors import ServiceError

router = APIRouter()
TTL = 3600
TOKEN = re.compile(r"bv1\.([a-f0-9]{32})\.(\d{10})\.([a-f0-9]{64})")


class Login(BaseModel):
    code: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,256}$")


class MobileSettings(Protocol):
    allow_anonymous: bool
    mobile_signing_key: str

    @property
    def api_key_set(self) -> frozenset[str]: ...


class MobileAuth(ApiKeyAuth):
    def __init__(self, settings: MobileSettings, paths: tuple[str, ...]) -> None:
        super().__init__(settings)
        self.paths = paths
        if settings.mobile_signing_key:
            key = settings.mobile_signing_key.encode()
            self.keys = [hmac.digest(key, b"bird/mobile/shared/v1", "sha256")]
        else:
            self.keys = [
                hmac.digest(key.encode(), b"bird-vision/mobile/v1", "sha256")
                for key in sorted(settings.api_key_set)
            ]

    def issue(self, identity: str) -> str:
        if self.settings.allow_anonymous or not self.keys:
            raise ServiceError("LOGIN_UNAVAILABLE", "authenticated vision service required", 503)
        subject = hashlib.sha256(identity.encode()).hexdigest()[:32]
        payload = f"bv1.{subject}.{int(time.time()) + TTL}"
        return f"{payload}.{hmac.digest(self.keys[0], payload.encode(), 'sha256').hex()}"

    def _verify(self, provided: str | None) -> Principal:
        if provided and provided.startswith("bv1."):
            match = TOKEN.fullmatch(provided)
            if match and int(match[2]) > time.time():
                payload = provided.rsplit(".", 1)[0].encode()
                if any(
                    hmac.compare_digest(hmac.digest(key, payload, "sha256").hex(), match[3])
                    for key in self.keys
                ):
                    return Principal(f"mobile:{match[1]}")
            raise ServiceError("AUTH_INVALID", "invalid mobile session", 401)
        return super()._verify(provided)

    def verify_request(self, request: Request) -> Principal:
        principal = super().verify_request(request)
        path = request.url.path
        if principal.subject.startswith("mobile:") and not any(
            path == prefix or path.startswith(prefix + "/") for prefix in self.paths
        ):
            raise ServiceError("FORBIDDEN", "mobile session scope exceeded", 403)
        return principal


@router.post("/api/v1/vision/auth/wechat")
def login(body: Login, request: Request, response: Response) -> dict:
    settings = request.app.state.settings
    if not settings.wechat_app_id or not settings.wechat_app_secret or settings.allow_anonymous:
        raise ServiceError("LOGIN_UNAVAILABLE", "WeChat login is not configured", 503)
    params = urlencode(
        dict(
            appid=settings.wechat_app_id,
            secret=settings.wechat_app_secret,
            js_code=body.code,
            grant_type="authorization_code",
        )
    )
    try:
        with urlopen("https://api.weixin.qq.com/sns/jscode2session?" + params, timeout=5) as upstream:
            result = json.loads(upstream.read(8192))
    except (OSError, ValueError):
        raise ServiceError("LOGIN_UNAVAILABLE", "WeChat login unavailable", 503) from None
    openid = result.get("openid") if isinstance(result, dict) else None
    if not isinstance(openid, str) or not openid:
        raise ServiceError("LOGIN_FAILED", "WeChat login failed", 401)
    response.headers["Cache-Control"] = "no-store"
    token = request.app.state.auth.issue(f"wx:{settings.wechat_app_id}:{openid}")
    return {"access_token": token, "expires_in": TTL}
