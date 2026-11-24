import getpass
import os
import re
import secrets
import sys
from pathlib import Path

from dotenv import dotenv_values, set_key


def main():
    if os.geteuid() != 0 or sys.argv[1:] not in (["init"], ["wechat"], ["gpu-key"]):
        sys.exit("用 root 运行并选择 init、wechat 或 gpu-key。")
    os.umask(0o077)
    target = Path("/etc/bird-assistant/business.env")
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    existing = dotenv_values(target) if target.exists() else {}
    mode = sys.argv[1]
    if mode == "gpu-key":
        signing_key = existing.get("BIRD_BUSINESS_MOBILE_SIGNING_KEY") or ""
        if sys.stdout.isatty() or not re.fullmatch(r"[a-f0-9]{64}", signing_key):
            sys.exit("签名密钥仅通过部署管道分发。")
        print(signing_key)
        return
    if mode == "wechat":
        if not sys.stdin.isatty() or not existing.get("BIRD_BUSINESS_MOBILE_SIGNING_KEY"):
            sys.exit("完成服务器安装后，在交互式 SSH 终端设置 AppSecret。")
        secret = getpass.getpass("wx6746d0442771cbde 的 AppSecret（输入隐藏）：").strip()
        if not re.fullmatch(r"[A-Za-z0-9_-]{16,128}", secret):
            sys.exit("AppSecret 格式有误，请到微信公众平台核对。")
        set_key(target, "BIRD_BUSINESS_WECHAT_APP_SECRET", secret)
        return
    values = {
        "BIRD_BUSINESS_WECHAT_APP_ID": "wx6746d0442771cbde",
        "BIRD_BUSINESS_MOBILE_SIGNING_KEY": (
            existing.get("BIRD_BUSINESS_MOBILE_SIGNING_KEY") or secrets.token_hex(32)
        ),
        "BIRD_BUSINESS_API_KEYS": existing.get("BIRD_BUSINESS_API_KEYS") or secrets.token_hex(32),
        "BIRD_BUSINESS_ENVIRONMENT": "production",
        "BIRD_BUSINESS_ALLOW_ANONYMOUS": "false",
        "BIRD_BUSINESS_DATABASE_PATH": "/var/lib/bird-business/observations.sqlite3",
    }
    for key, value in values.items():
        if existing.get(key) != value:
            set_key(target, key, value)
    target.chmod(0o600)


if __name__ == "__main__":
    main()
