import argparse
import json
import subprocess
from uuid import uuid4

import httpx


def main():
    parser = argparse.ArgumentParser(description="用临时身份检查生产社区账号、好友、私信和群聊")
    parser.add_argument("--host", default="ubuntu@49.233.81.227")
    parser.add_argument("--origin", default="https://api.auroraliu.cn:8080")
    args = parser.parse_args()
    nonce = uuid4().hex
    remote = (
        "sudo -n env PYTHONPATH=/opt/bird-assistant/community-current/src "
        "/opt/bird-assistant/venv/bin/python -"
    )
    setup = """
from bird_business.config import BusinessSettings
from bird_common.mobile_auth import MobileAuth
settings = BusinessSettings(_env_file='/etc/bird-assistant/business.env')
auth = MobileAuth(settings, ())
"""
    ssh = ["ssh", "-oBatchMode=yes", args.host, remote]
    command = setup + f"\nprint(*(auth.issue('smoke-social-'+{nonce!r}+role) for role in ('a','b')))"
    output = subprocess.run(ssh, input=command, text=True, capture_output=True, check=True)
    accounts = [{"Authorization": "Bearer " + value} for value in output.stdout.split()]
    identities = []
    with httpx.Client(base_url=args.origin + "/api/v1/community/", trust_env=False, timeout=20) as client:

        def call(who, method, path, payload=None):
            reply = client.request(method, path, headers=accounts[who], json=payload)
            reply.raise_for_status()
            return reply.json()

        try:
            for index in range(2):
                user = call(index, "GET", "account")
                assert user["profile"] is None
                identities.append(user["id"])
                call(
                    index,
                    "PUT",
                    "account",
                    {"handle": f"test_{nonce[:12]}_{index}", "nickname": "联调鸟友", "discoverable": False},
                )
            first, second = identities
            call(0, "PUT", f"friends/{second}/request")
            assert call(1, "GET", "friends")["items"][0]["relationship"] == "incoming"
            call(1, "PUT", f"friends/{first}/accept")
            assert call(0, "GET", f"members/{second}")["canMessage"]
            sent = call(0, "POST", f"messages/{second}", {"body": "私信联调", "reference": "message"})["id"]
            assert call(1, "GET", "inbox")["items"][0]["unread"] == 1
            assert call(1, "GET", f"messages/{first}")["items"][0]["id"] == sent
            call(1, "PUT", f"messages/{first}/read/{sent}")
            assert not call(1, "GET", "inbox")["items"][0]["unread"]
            room = call(0, "POST", "groups", {"name": "私有联调群", "reference": "group"})["id"]
            call(0, "PUT", f"groups/{room}/invites/{second}")
            call(1, "PUT", f"groups/{room}/membership/accept")
            call(1, "POST", f"groups/{room}/messages", {"body": "群聊联调", "reference": "group-message"})
            assert call(0, "GET", f"groups/{room}")["items"][0]["body"] == "群聊联调"
            call(0, "PUT", f"groups/{room}/membership/disband")
            call(1, "PUT", f"blocks/{first}")
            assert not call(0, "GET", "friends")["items"]
            assert not call(0, "GET", "inbox")["items"]
        finally:
            cleanup = (
                setup
                + "\nids = "
                + repr(identities)
                + "\nhandles = "
                + repr([f"test_{nonce[:12]}_{index}" for index in range(2)])
                + "\n"
                + """
import sqlite3
with sqlite3.connect(settings.database_path) as db:
    for member, handle in zip(ids, handles):
        if not db.execute('SELECT 1 FROM profiles WHERE member=? AND handle=?',(member,handle)).fetchone():
            continue
        for table in ('group_members','group_messages'):
            query = f'DELETE FROM {table} WHERE room IN (SELECT id FROM bird_groups WHERE owner=?)'
            db.execute(query,(member,))
        entries = [('messages','sender'),('blocks','owner'),('chat_reads','owner'),('bird_groups','owner'),
                   ('friendships','requester'),('profiles','member'),('members','id')]
        for table, column in entries:
            db.execute(f'DELETE FROM {table} WHERE {column}=?',(member,))
"""
            )
            subprocess.run(ssh, input=cleanup, text=True, capture_output=True, check=True)
    print(
        json.dumps(
            {
                "registration": "ok",
                "friends": "ok",
                "privateMessages": "ok",
                "unread": "ok",
                "groupInvites": "ok",
                "groupChat": "ok",
                "block": "ok",
            }
        )
    )


if __name__ == "__main__":
    main()
