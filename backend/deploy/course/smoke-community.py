import argparse
import subprocess
import uuid
from pathlib import Path

import httpx


def main():
    parser = argparse.ArgumentParser(description="使用临时身份经 HTTPS 验证识别和社区发布")
    parser.add_argument("image", type=Path)
    parser.add_argument("--host", default="ubuntu@49.233.81.227")
    parser.add_argument("--origin", default="https://api.auroraliu.cn:8080")
    args = parser.parse_args()
    remote = (
        "sudo env PYTHONPATH=/opt/bird-assistant/community-current/src /opt/bird-assistant/venv/bin/python"
    )
    identity = "smoke-" + uuid.uuid4().hex
    code = (
        "from bird_business.config import BusinessSettings\nfrom bird_common.mobile_auth import MobileAuth\n"
        "settings=BusinessSettings(_env_file='/etc/bird-assistant/business.env')\n"
        "auth=MobileAuth(settings,())\n"
        f"print(auth.issue({identity!r}),auth.issue({(identity + '-reader')!r}))"
    )
    result = subprocess.run(
        ["ssh", "-oBatchMode=yes", args.host, remote + " -"],
        input=code,
        text=True,
        check=True,
        capture_output=True,
    )
    author, reader = [{"Authorization": "Bearer " + value} for value in result.stdout.split()]
    root = "/api/v1/community"
    with httpx.Client(base_url=args.origin, timeout=90, trust_env=False) as client:

        def call(method, path, header=author, **kwargs):
            response = client.request(method, path, headers=header, **kwargs)
            response.raise_for_status()
            return response.json() if response.content else None

        image = (args.image.name, args.image.read_bytes(), "image/jpeg")
        analysis = call("POST", "/api/v1/vision/analyses", files={"image": image})
        subject = next(item for item in analysis["subjects"] if item["candidates"])
        species = subject["candidates"][0]["species_id"]
        print("GPU candidate", species, flush=True)
        media = call("POST", root + "/media", files={"file": image})
        observation = call(
            "PUT",
            "/api/v2/observations/by-reference/" + identity,
            json={
                "reference": identity,
                "analysis": analysis["analysis_id"],
                "target": subject["rank"],
                "species": species,
                "point": {"latitude": 39.91471, "longitude": 116.39937, "system": "GCJ-02"},
                "media": media["id"],
            },
        )
        preview = call(
            "POST",
            root + "/previews",
            json={
                "sighting": observation["id"],
                "channels": ["map", "post"],
                "share_photo": True,
                "title": "部署联调（自动撤回）",
            },
        )
        rows = call("POST", root + "/publications", json={"preview": preview["id"]})["items"]
        try:
            for row in rows:
                assert client.get(root + "/publications/" + row["id"], headers=reader).status_code == 404
                assert row["id"].replace("_", "").isalnum()
                subprocess.run(
                    [
                        "ssh",
                        "-oBatchMode=yes",
                        args.host,
                        remote + " -m bird_business.moderation approve " + row["id"],
                    ],
                    check=True,
                    stdout=subprocess.DEVNULL,
                )
            for row in rows:
                item = call("GET", root + "/publications/" + row["id"], reader)
                assert item["related"] and item["speciesId"] == species
                assert client.get(item["image"]).headers["content-type"] == "image/jpeg"
            pins = call(
                "GET", "/api/v1/map/observations", reader, params={"speciesId": species, "scope": "public"}
            )
            assert next(row["id"] for row in rows if row["channel"] == "map") in {
                item["id"] for item in pins["items"]
            }
            sender, recipient = [call("GET", root + "/me", user)["id"] for user in (author, reader)]
            call("POST", root + "/messages/" + recipient, json={"reference": "smoke", "body": "联调"})
            assert call("GET", root + "/messages/" + sender, reader)["items"][0]["body"] == "联调"
            print("PASS photo, recognition, moderation, related map/post, species, DM", flush=True)
        finally:
            for row in rows:
                call("DELETE", root + "/publications/" + row["id"])
                assert client.get(root + "/publications/" + row["id"] + "/photo").status_code == 404
            print("Smoke publications withdrawn", flush=True)


if __name__ == "__main__":
    main()
