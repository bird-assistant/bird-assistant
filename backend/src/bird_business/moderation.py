import argparse
import json
from pathlib import Path
from urllib import request

from bird_business.config import BusinessSettings


def main():
    parser = argparse.ArgumentParser(description="羽迹社区审核，仅供服务器管理员使用")
    parser.add_argument("operation", choices=["list", "photo", "approve", "reject"])
    parser.add_argument("record", nargs="?")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.operation != "list" and not args.record:
        parser.error("需要记录 ID")
    if args.operation == "photo" and not args.output:
        parser.error("需要 --output 指定照片文件")
    settings = BusinessSettings(_env_file="/etc/bird-assistant/business.env")
    headers = {
        "Authorization": "Bearer " + next(iter(settings.api_key_set)),
        "Content-Type": "application/json",
    }
    path = "http://127.0.0.1:8200/api/v1/community/moderation"
    body = None
    if args.record:
        from urllib.parse import quote

        path += "/" + quote(args.record, safe="")
    if args.operation == "photo":
        path += "/photo"
    if args.operation in {"approve", "reject"}:
        body = json.dumps({"status": "approved" if args.operation == "approve" else "rejected"}).encode()
    with request.urlopen(request.Request(path, data=body, headers=headers), timeout=10) as response:
        if args.operation == "photo":
            with args.output.open("xb") as output:
                output.write(response.read())
        else:
            print(json.dumps(json.load(response), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
