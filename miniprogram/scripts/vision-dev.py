"""Run the DevTools vision tunnel from WSL. Stop with Ctrl+C."""

import json
import re
import subprocess
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

HOST = sys.argv[1] if len(sys.argv) > 1 else "bird-gpu-new"
ISSUE = ("cd /root/shared-nvme/bird-assistant/backend && "
         "PYTHONPATH=src /root/venvs/bird-vision/bin/python -m bird_vision.mobile_auth")


class Login(BaseHTTPRequestHandler):
    def do_POST(self):
        if (self.path != "/login" or self.headers.get("Host") != "127.0.0.1:18001"
                or self.headers.get("X-Bird-DevTools") != "vision"
                or self.headers.get("Origin") not in (None, "https://servicewechat.com")):
            self.send_error(403)
            return
        try:
            token = subprocess.check_output(["ssh", "-o", "BatchMode=yes", "--", HOST, ISSUE],
                                            timeout=12, text=True).strip()
            if not re.fullmatch(r"bv1\.[a-f0-9]{32}\.\d{10}\.[a-f0-9]{64}", token):
                raise ValueError("invalid ticket")
        except (ValueError, OSError, subprocess.SubprocessError):
            self.send_error(503)
            return
        body = json.dumps({"access_token": token, "expires_in": 3600}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    with HTTPServer(("127.0.0.1", 18001), Login) as server:
        forward = "127.0.0.1:18000:127.0.0.1:8000"
        tunnel = subprocess.Popen(["ssh", "-o", "ExitOnForwardFailure=yes", "-o", "ControlMaster=auto",
                                   "-T", "-L", forward, "--", HOST, "cat"], stdin=subprocess.PIPE)
        try:
            server.timeout = 1
            time.sleep(0.4)
            print("视觉联调已启动，打开开发者工具的识别页。按 Ctrl+C 关闭。", flush=True)
            while tunnel.poll() is None:
                server.handle_request()
            sys.exit(tunnel.returncode)
        except KeyboardInterrupt:
            pass
        finally:
            tunnel.stdin.close()
            subprocess.run(["ssh", "-O", "cancel", "-L", forward, "--", HOST], capture_output=True)
            tunnel.terminate()
            tunnel.wait()
