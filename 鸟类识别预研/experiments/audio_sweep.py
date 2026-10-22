"""Three experiments for the audio feasibility question.

1. window sweep     - how much audio does BirdNET actually need?
2. noise sweep      - how fast does it break under wind / traffic / speech?
3. negatives        - what does it say about clips with no bird at all?

    python experiments/audio_sweep.py --out results/audio
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from audio_lib import analyze, hit_rank, load_wav, mix_at_snr  # noqa: E402
from birdnet_runtime import BirdNet, SAMPLE_RATE  # noqa: E402
from common import device_info, summarize, write_json  # noqa: E402

WINDOWS = [0.5, 1.0, 2.0, 3.0]
SNRS = [20, 10, 5, 0]


def load_meta(path: Path) -> dict[str, dict]:
    with path.open(newline="", encoding="utf-8") as fh:
        return {row["clip"]: row for row in csv.DictReader(fh)}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--wav-dir", default="data/audio/wav")
    ap.add_argument("--labels", default="data/audio/labels.csv")
    ap.add_argument("--out", default="results/audio")
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("--topk", type=int, default=5)
    args = ap.parse_args(argv)

    out = Path(args.out).expanduser().resolve()
    out.mkdir(parents=True, exist_ok=True)
    meta = load_meta(Path(args.labels))
    net = BirdNet(threads=args.threads)

    birds = [p for p in sorted(Path(args.wav_dir).glob("A*.wav"))]
    noises = [p for p in sorted(Path(args.wav_dir).glob("N*.wav"))]
    if not birds:
        print("[error] no A*.wav clips found", file=sys.stderr)
        return 2

    # 1) window sweep -------------------------------------------------------
    win_rows = []
    for wav in birds:
        x = load_wav(wav)
        for w in WINDOWS:
            res = analyze(net, x, w, hop_s=w / 2, topk=args.topk)
            lat = [r["latency_ms"] for r in res["windows"]]
            rank = hit_rank(res["aggregate"], meta[wav.name]["scientific_name"])
            win_rows.append(
                {
                    "clip": wav.name,
                    "expected": meta[wav.name]["scientific_name"],
                    "window_s": w,
                    "windows": len(res["windows"]),
                    "hit_rank": rank,
                    "hit_top1": rank == 1,
                    "top1": res["aggregate"][0][0],
                    "p_top1": round(res["aggregate"][0][1], 4),
                    "latency": summarize(lat),
                }
            )
        print(f"window sweep: {wav.name} done", flush=True)

    # 2) noise sweep --------------------------------------------------------
    noise_rows = []
    for wav in birds:
        clean = load_wav(wav)
        expected = meta[wav.name]["scientific_name"]
        base = analyze(net, clean, 3.0, 1.5, topk=args.topk)
        base_rank = hit_rank(base["aggregate"], expected)
        noise_rows.append(
            {
                "clip": wav.name,
                "noise": "(none)",
                "snr_db": None,
                "hit_rank": base_rank,
                "hit_top1": base_rank == 1,
                "top1": base["aggregate"][0][0],
                "p_top1": round(base["aggregate"][0][1], 4),
            }
        )
        for noise_path in noises:
            noise = load_wav(noise_path)
            for snr in SNRS:
                mixed = mix_at_snr(clean, noise, snr)
                res = analyze(net, mixed, 3.0, 1.5, topk=args.topk)
                rank = hit_rank(res["aggregate"], expected)
                noise_rows.append(
                    {
                        "clip": wav.name,
                        "noise": noise_path.stem,
                        "snr_db": snr,
                        "hit_rank": rank,
                        "hit_top1": rank == 1,
                        "hit_top3": rank is not None and rank <= 3,
                        "top1": res["aggregate"][0][0],
                        "p_top1": round(res["aggregate"][0][1], 4),
                    }
                )
        print(f"noise sweep: {wav.name} done", flush=True)

    # 3) negatives ----------------------------------------------------------
    neg_rows = []
    for noise_path in noises:
        res = analyze(net, load_wav(noise_path), 3.0, 1.5, topk=args.topk)
        neg_rows.append(
            {
                "clip": noise_path.name,
                "topk": [[l, round(p, 4)] for l, p in res["aggregate"]],
                "max_prob": round(res["aggregate"][0][1], 4) if res["aggregate"] else 0.0,
                "false_alarm_at_0_25": res["aggregate"][0][1] >= 0.25 if res["aggregate"] else False,
                "false_alarm_at_0_5": res["aggregate"][0][1] >= 0.5 if res["aggregate"] else False,
            }
        )

    payload = {
        "device_info": device_info(),
        "config": {"model": str(net.model_path), "threads": args.threads, "windows_s": WINDOWS, "snrs_db": SNRS},
        "window_sweep": win_rows,
        "noise_sweep": noise_rows,
        "negatives": neg_rows,
    }
    write_json(out / "sweeps.json", payload)

    md = ["# 音频实验明细", ""]
    md += ["## 1. 窗长扫描（干净音频，hop = 窗长/2）", "",
           "| clip | 期望物种 | 窗长(s) | 窗数 | top-1 | top1 预测 | p | 单窗延迟 p50(ms) |",
           "|---|---|---|---|---|---|---|---|"]
    for r in win_rows:
        md.append(
            f"| {r['clip']} | {r['expected']} | {r['window_s']} | {r['windows']} | "
            f"{'✓' if r['hit_top1'] else '✗'} | {r['top1']} | {r['p_top1']} | {r['latency'].get('p50')} |"
        )
    md += ["", "## 2. 噪声注入（3s 窗，按 SNR 混入真实噪声）", "",
           "| clip | 噪声 | SNR(dB) | top1 | top1 预测 | p |", "|---|---|---|---|---|---|"]
    for r in noise_rows:
        md.append(
            f"| {r['clip']} | {r['noise']} | {r['snr_db'] if r['snr_db'] is not None else '-'} | "
            f"{'✓' if r['hit_top1'] else '✗'} | {r['top1']} | {r['p_top1']} |"
        )
    md += ["", "## 3. 负样本（无鸟）", "", "| clip | max p | ≥0.25 误报 | ≥0.5 误报 | top-3 |", "|---|---|---|---|---|"]
    for r in neg_rows:
        top3 = "; ".join(f"{l} {p}" for l, p in r["topk"][:3])
        md.append(f"| {r['clip']} | {r['max_prob']} | {r['false_alarm_at_0_25']} | {r['false_alarm_at_0_5']} | {top3} |")

    (out / "sweeps.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    print("\n".join(md[:14]))
    print(f"\nwrote {out / 'sweeps.json'} and {out / 'sweeps.md'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
