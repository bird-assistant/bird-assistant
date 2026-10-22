"""Collapse every run/eval JSON under results/ into one markdown table set.

    python experiments/summarize.py --root results --out results/summary.md
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def fmt(v, digits=2):
    if v is None:
        return "-"
    if isinstance(v, float):
        return f"{v:.{digits}f}"
    return str(v)


def species_stability(csv_path: str) -> dict | None:
    import csv as _csv
    from collections import defaultdict

    per_track: dict[str, list[str]] = defaultdict(list)
    try:
        with open(csv_path, newline="", encoding="utf-8") as fh:
            for row in _csv.DictReader(fh):
                label = row.get("species_top1") or ""
                tid = row.get("track_id") or ""
                if not label or not tid:
                    continue
                per_track[tid].append(label)
    except FileNotFoundError:
        return None
    seqs = [v for v in per_track.values() if len(v) >= 2]
    if not seqs:
        return None
    agree = sum(1 for s in seqs for a, b in zip(s, s[1:]) if a == b)
    pairs = sum(len(s) - 1 for s in seqs)
    return {
        "tracks": len(seqs),
        "agreement": agree / pairs,
        "distinct_mean": sum(len(set(s)) for s in seqs) / len(seqs),
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default="results")
    ap.add_argument("--out", default="results/summary.md")
    ap.add_argument(
        "--species-csv",
        action="append",
        default=[],
        help="per-frame CSV with species_top1; adds a temporal-stability table",
    )
    args = ap.parse_args(argv)

    root = Path(args.root).expanduser().resolve()
    runs, evals = [], []
    for path in sorted(root.rglob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        rel = path.relative_to(root).as_posix()
        if "latency_ms" in data and "config" in data:
            lat = data["latency_ms"]
            runs.append(
                {
                    "path": rel,
                    "model": Path(data["config"]["model"]).name,
                    "imgsz": data["config"]["imgsz"],
                    "tracker": data["config"]["tracker"],
                    "cls": data["config"]["cls_model"],
                    "frames": data["run"]["frames_processed"],
                    "fps": data["run"]["fps_processed"],
                    "rt": data["run"]["realtime_factor"],
                    "e2e_p50": lat.get("e2e_ms", {}).get("p50"),
                    "e2e_p95": lat.get("e2e_ms", {}).get("p95"),
                    "infer_p50": lat.get("model_inference_ms", {}).get("p50"),
                    "species_p50": lat.get("species_ms", {}).get("p50"),
                    "hit": data["detections"]["frame_hit_rate"],
                    "ids": data["tracking"]["unique_ids"],
                    "cpu": data["device_info"].get("cpu"),
                }
            )
        elif "recall_overall" in data:
            bins = data.get("per_bin", {})
            evals.append(
                {
                    "path": rel,
                    "label": data["label"],
                    "iou": data["iou_threshold"],
                    "frames": data["frames_compared"],
                    "ref": data["ref_boxes"],
                    "recall": data["recall_overall"],
                    "ge128": bins.get(">=128px", {}).get("recall"),
                    "b64": bins.get("64-128px", {}).get("recall"),
                    "b32": bins.get("32-64px", {}).get("recall"),
                    "fp": data.get("false_positive_rate_vs_ref"),
                }
            )

    lines = ["# 实验结果汇总", "", f"来源: `{root}`", ""]

    if runs:
        lines += [
            "## 运行记录（延迟/吞吐）",
            "",
            "| run | model | imgsz | tracker | cls | frames | fps | 实时比 | e2e p50(ms) | e2e p95(ms) | 检测 p50(ms) | 分类 p50(ms) | 有鸟帧占比 | track ids |",
            "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
        ]
        for r in sorted(runs, key=lambda d: d["path"]):
            lines.append(
                f"| `{r['path']}` | {r['model']} | {r['imgsz']} | {r['tracker']} | {r['cls']} | {r['frames']} | "
                f"{fmt(r['fps'])} | {fmt(r['rt'])} | {fmt(r['e2e_p50'])} | {fmt(r['e2e_p95'])} | "
                f"{fmt(r['infer_p50'])} | {fmt(r['species_p50'])} | {fmt(r['hit'], 3)} | {r['ids']} |"
            )
        cpus = {r["cpu"] for r in runs if r["cpu"]}
        if cpus:
            lines += ["", f"设备: {', '.join(sorted(cpus))}（CPU-only 推理）"]

    if evals:
        lines += [
            "",
            "## 检测召回（以 yolo11x@1280 为参照）",
            "",
            "| run | IoU | frames | ref boxes | 总召回 | ≥128px | 64-128px | 32-64px | 误检率 |",
            "|---|---|---|---|---|---|---|---|---|",
        ]
        for e in sorted(evals, key=lambda d: (d["label"], d["iou"])):
            lines.append(
                f"| {e['label']} | {e['iou']} | {e['frames']} | {e['ref']} | {fmt(e['recall'], 3)} | "
                f"{fmt(e['ge128'], 3)} | {fmt(e['b64'], 3)} | {fmt(e['b32'], 3)} | {fmt(e['fp'], 3)} |"
            )

    if args.species_csv:
        lines += [
            "",
            "## 物种候选的时序稳定性（同一 track 内 top-1 是否抖动）",
            "",
            "| run | tracks | 相邻帧 top-1 一致率 | 平均每 track 不同标签数 |",
            "|---|---|---|---|",
        ]
        for csv_path in args.species_csv:
            stats = species_stability(csv_path)
            if stats is None:
                continue
            lines.append(
                f"| `{Path(csv_path).name}` | {stats['tracks']} | {fmt(stats['agreement'], 3)} | {fmt(stats['distinct_mean'], 2)} |"
            )

    text = "\n".join(lines) + "\n"
    out = Path(args.out).expanduser().resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="utf-8")
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
