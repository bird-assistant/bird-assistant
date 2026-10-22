"""Download the media and model weights that are deliberately kept out of git.

Everything here is either large (>20 MB) or third-party, so the repository only
carries code, docs and small result files. This script restores a runnable
workspace.

    python scripts/fetch_assets.py              # videos + audio + models
    python scripts/fetch_assets.py --only videos
    python scripts/fetch_assets.py --only models --skip-audio-prepare

Files that are already present are skipped, so it is safe to re-run.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
UA = "BirdFeasibilityResearch/0.1 (academic feasibility study; contact: student@example.edu)"

# (relative path, minimum size, [mirrors], optional)
VIDEOS = [
    (
        "data/videos/V1_feeder_slovakia.webm",
        20 * 1024**2,
        ["https://upload.wikimedia.org/wikipedia/commons/3/30/Bird_feeder_in_the_mountains_of_Slovakia.webm"],
    ),
    (
        "data/videos/V2_koolmees_feeders.webm",
        20 * 1024**2,
        ["https://upload.wikimedia.org/wikipedia/commons/e/e7/Koolmees_op_vogelfeeders-4961804.webm"],
    ),
]

AUDIO = [
    ("data/audio/A1_blackbird.ogg", 5 * 1024**2, ["https://upload.wikimedia.org/wikipedia/commons/3/32/Turdus_merula_-_Common_Blackbird_XC125792.ogg"]),
    ("data/audio/A2_greattit.ogg", 1 * 1024**2, ["https://upload.wikimedia.org/wikipedia/commons/c/cd/Parus_major_-_Great_Tit_XC129643.ogg"]),
    ("data/audio/A3_bluetit.ogg", 2 * 1024**2, ["https://upload.wikimedia.org/wikipedia/commons/4/42/Cyanistes_caeruleus_-_Eurasian_Blue_Tit_XC131316.ogg"]),
    ("data/audio/A4_cuckoo.mp3", 1 * 1024**2, ["https://upload.wikimedia.org/wikipedia/commons/9/98/Cuculus_canorus_-_Common_Cuckoo_XC457076.mp3"]),
    ("data/audio/A5_chaffinch.mp3", 1 * 1024**2, ["https://upload.wikimedia.org/wikipedia/commons/7/77/Fringilla_coelebs_-_Common_Chaffinch_XC489277.mp3"]),
    ("data/audio/N1_speech.ogg", 5 * 1024**2, ["https://upload.wikimedia.org/wikipedia/commons/0/0a/Watt_Wikipedia_article_spoken_version.ogg"]),
    ("data/audio/N2_traffic.ogg", 3 * 1024**2, ["https://upload.wikimedia.org/wikipedia/commons/5/5d/Sunday_in_the_city_street_noise1.ogg"]),
]

MODELS = [
    (
        "models/yolo11n.pt",
        5 * 1024**2,
        [
            "https://github.com/ultralytics/assets/releases/download/v8.4.0/yolo11n.pt",
            "https://github.com/ultralytics/assets/releases/download/v8.3.0/yolo11n.pt",
        ],
    ),
    (
        "models/yolo11x.pt",
        100 * 1024**2,
        ["https://github.com/ultralytics/assets/releases/download/v8.4.0/yolo11x.pt"],
        True,  # optional: only needed to rebuild the pseudo-GT reference
    ),
    (
        "models/birdnet/BirdNET_GLOBAL_6K_V2.4_Model_FP32.tflite",
        40 * 1024**2,
        [
            "https://raw.githubusercontent.com/joeweiss/birdnetlib/main/src/birdnetlib/models/analyzer/BirdNET_GLOBAL_6K_V2.4_Model_FP32.tflite",
        ],
    ),
    (
        "models/birdnet/BirdNET_GLOBAL_6K_V2.4_Labels.txt",
        100 * 1024,
        [
            "https://raw.githubusercontent.com/joeweiss/birdnetlib/main/src/birdnetlib/models/analyzer/BirdNET_GLOBAL_6K_V2.4_Labels.txt",
        ],
    ),
]

TORCH_CACHE_NOTE = (
    "torchvision 权重（resnet50 97.8 MB / efficientnet_b0 20.5 MB）会在首次运行物种分类时"
    "自动下载到 TORCH_HOME（源码模式默认 ~/.cache/torch，便携版为 models/torch_hub）。"
)


def human(n: int) -> str:
    return f"{n / 1024**2:.1f} MB" if n >= 1024**2 else f"{n / 1024:.0f} KB"


def download(url: str, dest: Path, min_bytes: int) -> bool:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp, tmp.open("wb") as fh:
            total = int(resp.headers.get("Content-Length") or 0)
            done = 0
            while True:
                chunk = resp.read(1024 * 256)
                if not chunk:
                    break
                fh.write(chunk)
                done += len(chunk)
                if total:
                    print(f"\r    {done * 100 // total:3d}%  {human(done)} / {human(total)}", end="", flush=True)
        print()
    except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as exc:
        tmp.unlink(missing_ok=True)
        print(f"    失败：{exc}")
        return False
    size = tmp.stat().st_size
    if size < min_bytes:
        tmp.unlink(missing_ok=True)
        print(f"    内容过小（{human(size)}），可能是错误页，已丢弃")
        return False
    tmp.replace(dest)
    return True


def birdnet_from_installed(dest: Path) -> bool:
    """Fallback: identical files ship inside the birdnetlib wheel."""
    try:
        import importlib.util

        spec = importlib.util.find_spec("birdnetlib")
    except Exception:
        return False
    if not spec or not spec.origin:
        return False
    src = Path(spec.origin).parent / "models" / "analyzer" / dest.name
    if not src.exists():
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dest)
    print("    已从 birdnetlib 包内复制（pip install birdnetlib 可离线获得）")
    return True


def ensure(items, label: str) -> list[str]:
    print(f"\n== {label} ==")
    failed: list[str] = []
    for entry in items:
        rel, min_bytes, mirrors = entry[0], entry[1], entry[2]
        optional = len(entry) > 3 and entry[3]
        dest = REPO / rel
        if dest.exists() and dest.stat().st_size >= min_bytes:
            print(f"  跳过 {rel}（已存在 {human(dest.stat().st_size)}）")
            continue
        print(f"  下载 {rel}")
        ok = False
        for url in mirrors:
            print(f"    源 {url.split('/')[2]}")
            if download(url, dest, min_bytes):
                ok = True
                break
            time.sleep(1)
        if not ok and "birdnet" in rel:
            ok = birdnet_from_installed(dest)
        if ok:
            print(f"  完成 {rel}（{human(dest.stat().st_size)}）")
        elif optional:
            print(f"  可选文件缺失，忽略：{rel}")
        else:
            failed.append(rel)
    if failed:
        print("\n  [警告] 以下文件未能获取，相关实验无法运行：")
        for f in failed:
            print(f"    - {f}")
        print("  请检查网络后重试；GitHub 不可达时可设置代理或改用镜像。")
    return failed


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", choices=["all", "videos", "audio", "models"], default="all")
    ap.add_argument("--skip-audio-prepare", action="store_true", help="只下载，不执行 prepare_audio.py")
    args = ap.parse_args(argv)

    failed: list[str] = []
    if args.only in ("all", "videos"):
        failed += ensure(VIDEOS, "测试视频（Wikimedia Commons）")
    if args.only in ("all", "audio"):
        failed += ensure(AUDIO, "测试音频（Wikimedia Commons / xeno-canto）")
    if args.only in ("all", "models"):
        failed += ensure(MODELS, "模型权重")

    if args.only in ("all", "audio") and not args.skip_audio_prepare:
        wav_dir = REPO / "data/audio/wav"
        if (REPO / "data/audio/A1_blackbird.ogg").exists() and not wav_dir.exists():
            print("\n== 生成 48 kHz wav + labels.csv ==")
            rc = subprocess.run([sys.executable, str(REPO / "experiments/prepare_audio.py")], cwd=REPO).returncode
            if rc != 0:
                print(f"  prepare_audio.py 退出码 {rc}")
                failed.append("data/audio/wav/*.wav")
        elif wav_dir.exists():
            print(f"\n  跳过 prepare_audio（{wav_dir} 已存在）")

    print(f"\n{TORCH_CACHE_NOTE}")
    print("\n完成。" if not failed else f"\n完成，但有 {len(failed)} 项缺失。")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
