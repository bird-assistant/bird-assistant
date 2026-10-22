"""Run BirdNET v2.4 on one clip (or on every clip in data/audio/wav).

    python experiments/run_audio_baseline.py --wav data/audio/wav/A1_blackbird.wav \
        --window 3.0 --hop 1.5 --topk 5 --json results/audio/A1_blackbird.json

    python experiments/run_audio_baseline.py --all --json results/audio/all.json
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from audio_lib import analyze, hit_rank, load_wav  # noqa: E402
from birdnet_runtime import BirdNet, SAMPLE_RATE  # noqa: E402
from common import device_info, summarize, write_json  # noqa: E402


def load_meta(labels_csv: str | Path = "data/audio/labels.csv") -> dict[str, dict]:
    p = Path(labels_csv)
    if not p.exists():
        return {}
    with p.open(newline="", encoding="utf-8") as fh:
        return {row["clip"]: row for row in csv.DictReader(fh)}


def run_one(net, wav: Path, window: float, hop: float, topk: int, meta: dict) -> dict:
    t0 = time.perf_counter()
    x = load_wav(wav)
    load_ms = (time.perf_counter() - t0) * 1000
    result = analyze(net, x, window, hop, topk=topk)
    lat = [w["latency_ms"] for w in result["windows"]]
    info = meta.get(wav.name, {})
    rank = hit_rank(result["aggregate"], info.get("scientific_name", ""))
    return {
        "clip": wav.name,
        "expected": info.get("scientific_name") or info.get("common_name") or "",
        "kind": info.get("kind", "bird"),
        "audio_s": round(len(x) / SAMPLE_RATE, 2),
        "window_s": window,
        "hop_s": hop,
        "windows": len(result["windows"]),
        "aggregate_topk": result["aggregate"],
        "hit_rank": rank,
        "hit_top1": rank == 1,
        "hit_top3": rank is not None and rank <= 3,
        "latency_ms": summarize(lat),
        "load_ms": round(load_ms, 2),
        "per_window": result["windows"],
        "above_0_25": [[l, round(p, 4)] for l, p in result["aggregate"] if p >= 0.25],
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--wav", default="")
    ap.add_argument("--all", action="store_true", help="run every wav in data/audio/wav")
    ap.add_argument("--labels", default="data/audio/labels.csv")
    ap.add_argument("--window", type=float, default=3.0)
    ap.add_argument("--hop", type=float, default=1.5)
    ap.add_argument("--topk", type=int, default=5)
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("--json", default="")
    args = ap.parse_args(argv)

    meta = load_meta(args.labels)
    net = BirdNet(threads=args.threads)

    if args.all:
        wavs = sorted(Path("data/audio/wav").glob("*.wav"))
    elif args.wav:
        wavs = [Path(args.wav)]
    else:
        ap.error("pass --wav or --all")
        return 2

    runs = [run_one(net, w, args.window, args.hop, args.topk, meta) for w in wavs]

    payload = {
        "device_info": device_info(),
        "config": {
            "model": str(net.model_path),
            "labels": len(net.labels),
            "window_s": args.window,
            "hop_s": args.hop,
            "topk": args.topk,
            "threads": args.threads,
            "sample_rate": SAMPLE_RATE,
        },
        "runs": runs,
    }
    if args.json:
        write_json(args.json, payload)

    birds = [r for r in runs if r["kind"] == "bird" and r["expected"]]
    if birds:
        print(f"top-1 {sum(r['hit_top1'] for r in birds)}/{len(birds)}  "
              f"top-3 {sum(r['hit_top3'] for r in birds)}/{len(birds)}")
    for r in runs:
        top = r["aggregate_topk"][0] if r["aggregate_topk"] else ("-", 0)
        print(f"{r['clip']:<28} exp={r['expected']:<22} rank={r['hit_rank']} "
              f"top1={top[0][:38]:<40} p={top[1]:.3f} lat_p50={r['latency_ms'].get('p50')}ms")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
