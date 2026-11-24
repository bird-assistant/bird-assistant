import argparse
import subprocess
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import httpx


def main():
    parser = argparse.ArgumentParser(
        description="验证线上地图咨询首问、追问和重复提交。配置密钥后会调用云端模型。"
    )
    parser.add_argument("--host", default="ubuntu@49.233.81.227")
    parser.add_argument("--question", default="带孩子在北京观鸟，明早两小时怎样安排？请核对首选地的天气。")
    args = parser.parse_args()
    issuer = """from bird_common.mobile_auth import MobileAuth
from bird_business.config import BusinessSettings
from uuid import uuid4
settings=BusinessSettings(_env_file='/etc/bird-assistant/business.env')
print(MobileAuth(settings,()).issue('trip-smoke-'+uuid4().hex))"""
    remote = (
        "sudo -n env PYTHONPATH=/opt/bird-assistant/community-current/src "
        "/opt/bird-assistant/venv/bin/python -"
    )
    token = subprocess.run(
        ["ssh", "-oBatchMode=yes", args.host, remote],
        input=issuer,
        text=True,
        capture_output=True,
        check=True,
    ).stdout.strip()
    tomorrow = datetime.now(timezone(timedelta(hours=8))).date() + timedelta(days=1)
    body = {
        "latitude": 39.9,
        "longitude": 116.4,
        "hours": 2,
        "radius": 30,
        "date": str(tomorrow),
        "startHour": 7,
        "species": "",
        "question": args.question,
        "requestId": uuid4().hex,
    }
    path = "/api/v1/map/trip-plan"
    with httpx.Client(base_url="https://api.auroraliu.cn:8080", timeout=65, trust_env=False) as client:
        assert client.post(path, json=body).status_code == 401

        def ask():
            result = client.post(path, headers={"Authorization": "Bearer " + token}, json=body)
            if not result.is_success:
                raise SystemExit(f"HTTP {result.status_code} {result.json().get('error', {}).get('code')}")
            plan = result.json()
            assert (
                plan["engine"] == "dashscope"
                and plan["sources"]
                and plan["answer"]
                and plan["trace"]["calls"] > 0
            )
            return plan

        first = ask()
        assert ask() == first
        body.update(parentTurn=first["turn"], requestId=uuid4().hex, question="如果小朋友只想看半小时呢？")
        second = ask()
        assert second["turn"] != first["turn"]
        for plan in (first, second):
            print(plan["model"], plan["trace"], plan["answer"], sep="\n")


if __name__ == "__main__":
    main()
