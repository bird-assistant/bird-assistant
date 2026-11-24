import argparse
import hashlib
import os
import re
import secrets
import tempfile
from pathlib import Path


def replace_private(path, text):
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False, encoding="ascii") as output:
        output.write(text + "\n")
    os.replace(output.name, path)


def main():
    parser = argparse.ArgumentParser(description="配置羽迹管理平台的随机登录密码")
    parser.add_argument("--rotate", action="store_true", help="为管理平台生成新密码")
    args = parser.parse_args()
    directory = Path("/etc/bird-assistant")
    password_file = directory / "admin-password"
    if args.rotate or not password_file.exists():
        replace_private(password_file, secrets.token_urlsafe(32))
    password = password_file.read_text(encoding="ascii").strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]{43}", password):
        raise SystemExit("管理密码文件格式不正确")
    digest = hashlib.sha256(password.encode()).hexdigest()
    replace_private(directory / "admin.env", "BIRD_BUSINESS_ADMIN_PASSWORD_SHA256=" + digest)


if __name__ == "__main__":
    main()
