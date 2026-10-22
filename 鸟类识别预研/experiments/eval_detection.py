"""Reference-based detection recall with size bins.

There is no hand-labelled ground truth in week 1, so a stronger model at higher
resolution is used as a *reference* (pseudo-GT). Recall here means "fraction of
reference boxes the candidate model also found", which is the right signal for
comparing resolutions and difficulty variants, but it is not absolute accuracy.

    python experiments/eval_detection.py \
        --ref results/eval/yolo11x_1280_frames.csv \
        --pred results/eval/yolo11n_640_frames.csv \
        --label yolo11n@640 --out results/eval/yolo11n_640_vs_ref.json
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

BINS = [(0, 32, "<32px"), (32, 64, "32-64px"), (64, 128, "64-128px"), (128, 10**9, ">=128px")]


def load(path: str) -> dict[int, list[dict]]:
    frames: dict[int, list[dict]] = defaultdict(list)
    with open(path, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            frames[int(row["frame"])].append(
                {
                    "box": (float(row["x1"]), float(row["y1"]), float(row["x2"]), float(row["y2"])),
                    "conf": float(row["conf"]),
                }
            )
    return frames


def iou(a, b) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    area_a = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    area_b = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
    return inter / max(area_a + area_b - inter, 1e-9)


def bin_of(side: float) -> str:
    for lo, hi, name in BINS:
        if lo <= side < hi:
            return name
    return BINS[-1][2]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ref", required=True)
    ap.add_argument("--pred", required=True)
    ap.add_argument("--iou", type=float, default=0.5)
    ap.add_argument("--label", default="candidate")
    ap.add_argument(
        "--ref-transform",
        default="",
        help="affine map applied to ref boxes as 'sx,sy,dx,dy' (for letterboxed variants)",
    )
    ap.add_argument("--out", default="")
    args = ap.parse_args(argv)

    ref, pred = load(args.ref), load(args.pred)
    if args.ref_transform:
        sx, sy, dx, dy = (float(v) for v in args.ref_transform.split(","))
        for boxes in ref.values():
            for b in boxes:
                x1, y1, x2, y2 = b["box"]
                b["box"] = (x1 * sx + dx, y1 * sy + dy, x2 * sx + dx, y2 * sy + dy)
    common_frames = sorted(set(ref) & set(pred))
    if not common_frames:
        print("[error] no overlapping frames between ref and pred", file=sys.stderr)
        return 2

    stats = {name: {"ref": 0, "hit": 0} for _, _, name in BINS}
    missed_examples = []
    pred_total = pred_matched = 0

    for f in common_frames:
        refs = ref[f]
        preds = sorted(pred[f], key=lambda d: -d["conf"])
        used = [False] * len(preds)
        for r in refs:
            side = max(r["box"][2] - r["box"][0], r["box"][3] - r["box"][1])
            name = bin_of(side)
            stats[name]["ref"] += 1
            best_i, best_iou = -1, 0.0
            for i, p in enumerate(preds):
                if used[i]:
                    continue
                v = iou(r["box"], p["box"])
                if v > best_iou:
                    best_i, best_iou = i, v
            if best_i >= 0 and best_iou >= args.iou:
                used[best_i] = True
                stats[name]["hit"] += 1
                pred_matched += 1
            else:
                missed_examples.append({"frame": f, "side_px": round(side, 1), "bin": name, "best_iou": round(best_iou, 3)})
        pred_total += len(preds)

    overall_ref = sum(s["ref"] for s in stats.values())
    overall_hit = sum(s["hit"] for s in stats.values())
    per_bin = {
        name: {
            "ref_boxes": s["ref"],
            "matched": s["hit"],
            "recall": round(s["hit"] / s["ref"], 4) if s["ref"] else None,
        }
        for name, s in stats.items()
    }

    report = {
        "label": args.label,
        "ref_csv": str(Path(args.ref).resolve()),
        "pred_csv": str(Path(args.pred).resolve()),
        "iou_threshold": args.iou,
        "frames_compared": len(common_frames),
        "ref_boxes": overall_ref,
        "matched": overall_hit,
        "recall_overall": round(overall_hit / overall_ref, 4) if overall_ref else None,
        "per_bin": per_bin,
        "pred_boxes": pred_total,
        "pred_unmatched": pred_total - pred_matched,
        "false_positive_rate_vs_ref": round((pred_total - pred_matched) / pred_total, 4) if pred_total else None,
        "missed_examples": sorted(missed_examples, key=lambda d: d["side_px"])[:20],
    }

    print(f"\n{args.label}: recall {report['recall_overall']} on {report['ref_boxes']} ref boxes "
          f"({len(common_frames)} frames, IoU>={args.iou})")
    print(f"{'bin':<10}{'ref':>6}{'match':>7}{'recall':>8}")
    for _, _, name in BINS:
        b = per_bin[name]
        rec = "-" if b["recall"] is None else f"{b['recall']:.3f}"
        print(f"{name:<10}{b['ref_boxes']:>6}{b['matched']:>7}{rec:>8}")
    print(f"pred boxes {pred_total}, unmatched {report['pred_unmatched']} "
          f"(FP rate {report['false_positive_rate_vs_ref']})")

    if args.out:
        outp = Path(args.out).expanduser().resolve()
        outp.parent.mkdir(parents=True, exist_ok=True)
        outp.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
