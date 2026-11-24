import hashlib
import secrets
from dataclasses import dataclass
from threading import Lock
from time import monotonic

from fastapi import Request

from bird_common.errors import ServiceError

COOKIE = "__Secure-bird-review"
LIFETIME = 8 * 3600


@dataclass(frozen=True)
class Session:
    csrf: str
    expires: float


class AdminSessions:
    def __init__(self, password_digest: str):
        self.password_digest = password_digest
        self.sessions: dict[str, Session] = {}
        self.failures: dict[str, list[float]] = {}
        self.lock = Lock()

    def login(self, address: str, username: str, password: str) -> tuple[str, Session]:
        if not self.password_digest:
            raise ServiceError("ADMIN_DISABLED", "管理平台尚未配置登录凭据", 503)
        current = monotonic()
        with self.lock:
            self.failures = {
                host: recent
                for host, attempts in self.failures.items()
                if (recent := [stamp for stamp in attempts if stamp > current - 600])
            }
            failed = self.failures.get(address, [])
            if len(failed) >= 8 or sum(map(len, self.failures.values())) >= 256:
                raise ServiceError("LOGIN_LIMIT", "登录尝试过多，请稍后再试", 429)
            digest = hashlib.sha256(password.encode()).hexdigest()
            if not secrets.compare_digest(digest, self.password_digest) or username != "admin":
                self.failures[address] = [*failed, current]
                raise ServiceError("LOGIN_FAILED", "账号或密码不正确", 401)
            self.failures.pop(address, None)
            self.sessions = {key: value for key, value in self.sessions.items() if value.expires > current}
            token = secrets.token_urlsafe(32)
            session = Session(secrets.token_urlsafe(32), current + LIFETIME)
            self.sessions[token] = session
            return token, session

    def get(self, token: str) -> Session:
        with self.lock:
            session = self.sessions.get(token)
            if session and session.expires > monotonic():
                return session
            self.sessions.pop(token, None)
        raise ServiceError("LOGIN_REQUIRED", "请登录管理平台", 401)

    def logout(self, token: str):
        with self.lock:
            self.sessions.pop(token, None)


def same_origin(request: Request):
    if request.headers.get("origin") != "https://" + request.headers.get("host", ""):
        raise ServiceError("ORIGIN_DENIED", "请从管理平台页面提交操作", 403)


def authenticated(request: Request) -> Session:
    return request.app.state.admin_sessions.get(request.cookies.get(COOKIE, ""))


def authorized_write(request: Request):
    same_origin(request)
    session = authenticated(request)
    supplied = request.headers.get("x-review-csrf", "").encode()
    if not secrets.compare_digest(supplied, session.csrf.encode()):
        raise ServiceError("CSRF_DENIED", "请刷新页面后重新提交", 403)
