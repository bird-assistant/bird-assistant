"""Run the DevTools vision tunnel from WSL. Stop with Ctrl+C."""

import json
import re
import subprocess
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.request import ProxyHandler, build_opener

HOST = sys.argv[1] if len(sys.argv) > 1 else "bird-gpu-new"
ISSUE = ("cd /root/shared-nvme/bird-assistant/backend && "
         "PYTHONPATH=src /root/venvs/bird-vision/bin/python -m bird_vision.mobile_auth")


def wait_ready(tunnel, timeout=15):
    """Report success only after both the SSH child and forwarded model respond."""
    opener = build_opener(ProxyHandler({}))
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if tunnel.poll() is not None:
            raise RuntimeError("SSH联调未启动，请检查上方的主机别名、认证或网络错误。")
        try:
            with opener.open("http://127.0.0.1:18000/readyz", timeout=1) as response:
                ready = json.load(response)
            if isinstance(ready, dict) and ready.get("status") == "ready":
                if tunnel.poll() is not None:
                    raise RuntimeError("SSH连接已退出，本机联调没有运行。")
                return
        except (OSError, ValueError):
            pass
        time.sleep(0.2)
    raise RuntimeError("视觉联调尚未就绪，请检查SSH转发与GPU服务；未启动识别。")


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


def main():
    with HTTPServer(("127.0.0.1", 18001), Login) as server:
        forward = "127.0.0.1:18000:127.0.0.1:8000"
        tunnel = subprocess.Popen(["ssh", "-o", "ExitOnForwardFailure=yes", "-o", "ControlMaster=auto",
                                   "-T", "-L", forward, "--", HOST, "cat"], stdin=subprocess.PIPE)
        try:
            server.timeout = 1
            wait_ready(tunnel)
            print("视觉联调已启动，打开开发者工具的识别页。按 Ctrl+C 关闭。", flush=True)
            while tunnel.poll() is None:
                server.handle_request()
            return tunnel.returncode or 1
        except KeyboardInterrupt:
            return 0
        except RuntimeError as error:
            print(str(error), file=sys.stderr, flush=True)
            return 1
        finally:
            try:
                tunnel.stdin.close()
            except OSError:
                pass
            try:
                subprocess.run(["ssh", "-O", "cancel", "-L", forward, "--", HOST], capture_output=True, timeout=5)
            except (OSError, subprocess.TimeoutExpired):
                pass
            if tunnel.poll() is None:
                tunnel.terminate()
            try:
                tunnel.wait(timeout=5)
            except subprocess.TimeoutExpired:
                tunnel.kill()
                tunnel.wait()


if __name__ == "__main__":
    sys.exit(main())
