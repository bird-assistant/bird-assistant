import argparse
import getpass
import http.client
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path


def read_key():
    key = getpass.getpass("粘贴北京百炼完整 API Key 后按回车（输入隐藏） ").strip()
    if not key:
        raise SystemExit("没有收到 API Key。请重新运行，粘贴后再按回车。")
    if any(mask in key for mask in ("*", "…", "...")):
        raise SystemExit("粘贴的是脱敏值。请复制创建时保存的完整 API Key。")
    if key.startswith(("http://", "https://")):
        raise SystemExit("收到的是网址。请粘贴创建时保存的完整 API Key。")
    if not re.fullmatch(r"[A-Za-z0-9._~+/\-]+=*", key):
        raise SystemExit("请仅粘贴 API Key 本身，去掉引号、空格或 export 命令。")
    return key


def verify_model(key, model, workspace):
    host = f"{workspace}.cn-beijing.maas.aliyuncs.com" if workspace else "dashscope.aliyuncs.com"
    connection = http.client.HTTPSConnection(host, timeout=25)
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": "Reply OK"}],
        "max_tokens": 4,
        "enable_thinking": False,
    }
    try:
        connection.request(
            "POST",
            "/compatible-mode/v1/chat/completions",
            json.dumps(payload),
            {"Authorization": "Bearer " + key, "Content-Type": "application/json"},
        )
        response = connection.getresponse()
        if response.status != 200:
            hints = {
                401: "请检查完整密钥及其北京地域归属。",
                403: "请检查模型权限、IP 白名单或账户状态。",
                404: "请检查北京地域的模型名称和业务空间。",
                429: "请检查账户额度或稍后重试。",
            }
            raise SystemExit(
                f"百炼返回 HTTP {response.status}。" + hints.get(response.status, "请稍后重试。")
            )
        result = json.loads(response.read(65537))
        if not isinstance(result, dict) or not result.get("choices"):
            raise ValueError("missing choices")
    except (OSError, http.client.HTTPException):
        raise SystemExit("服务器连接百炼失败或超时，请稍后重试。") from None
    except ValueError:
        raise SystemExit("百炼返回了无法解析的模型响应，请稍后重试。") from None
    finally:
        connection.close()


def main():
    parser = argparse.ArgumentParser(description="配置地图出行顾问的北京百炼凭据。")
    parser.add_argument("--model", default="qwen-plus", help="北京百炼模型名（默认 qwen-plus）")
    parser.add_argument("--workspace", default="", help="可选的北京专属接入点 Workspace ID")
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise SystemExit("请使用 sudo 在业务服务器上运行。")
    model, workspace = args.model, args.workspace
    if not re.fullmatch(r"qwen[a-zA-Z0-9._-]{0,79}", model):
        raise SystemExit("模型名无效。省略 --model 即使用 qwen-plus。")
    if workspace and not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,61}[a-z0-9]", workspace):
        raise SystemExit("Workspace ID 无效。使用北京公共地址时省略 --workspace。")
    if not sys.stdin.isatty():
        raise SystemExit("请输入交互式终端，远程运行时使用 ssh -t。")
    print(f"使用北京百炼 {model}，保存前将发送一个最多输出 4 个 token 的测试请求。")
    key = read_key()
    verify_model(key, model, workspace)
    destination = Path("/etc/bird-assistant/trip.env")
    with tempfile.NamedTemporaryFile(mode="w", dir=destination.parent, delete=False) as env:
        env.write(f"BIRD_BUSINESS_TRIP_MODEL={model}\nBIRD_BUSINESS_TRIP_API_KEY={key}\n")
        env.write(f"BIRD_BUSINESS_TRIP_WORKSPACE={workspace}\n")
    os.replace(env.name, destination)
    subprocess.run(["systemctl", "restart", "bird-business"], check=True)
    print("百炼模型验证成功，凭据已保存，业务服务已重启。")


if __name__ == "__main__":
    main()
