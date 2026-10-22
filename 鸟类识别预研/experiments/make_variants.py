"""Generate controlled difficulty variants from one clip (distance / light / blur / occlusion).

Variants keep the original resolution, fps and frame count so detections can be
compared frame-by-frame against the clean baseline.

    python experiments/make_variants.py --source data/videos/V1_feeder_slovakia.webm \
        --out-dir data/videos/variants --frames 300 --variants tiny,dark,blur,occlude \
        --ref-csv results/V1/yolo11n_640_frames.csv
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import make_writer, open_video, to_ascii_output, video_meta  # noqa: E402


def motion_blur(img: np.ndarray, k: int) -> np.ndarray:
    kernel = np.zeros((k, k), dtype=np.float32)
    kernel[k // 2, :] = 1.0 / k
    kernel = cv2.warpAffine(
        kernel,
        cv2.getRotationMatrix2D((k / 2 - 0.5, k / 2 - 0.5), 25, 1.0),
        (k, k),
    )
    kernel /= max(kernel.sum(), 1e-6)
    return cv2.filter2D(img, -1, kernel)


def apply_tiny(frame: np.ndarray, scale: float, size: tuple[int, int]) -> np.ndarray:
    h, w = frame.shape[:2]
    small = cv2.resize(frame, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    canvas = np.zeros((size[1], size[0], 3), dtype=np.uint8)
    y0 = (size[1] - small.shape[0]) // 2
    x0 = (size[0] - small.shape[1]) // 2
    canvas[y0 : y0 + small.shape[0], x0 : x0 + small.shape[1]] = small
    return canvas


def apply_dark(frame: np.ndarray, gain: float = 0.35, sigma: float = 8.0) -> np.ndarray:
    rng = np.random.default_rng(0)
    out = frame.astype(np.float32) * gain
    out += rng.normal(0.0, sigma, out.shape)
    return np.clip(out, 0, 255).astype(np.uint8)


def apply_occlude(frame: np.ndarray, boxes: list[tuple[float, float, float, float]], coverage: float = 0.6) -> np.ndarray:
    out = frame.copy()
    rng = np.random.default_rng(42)
    for x1, y1, x2, y2 in boxes:
        cx, cy = int((x1 + x2) / 2), int((y1 + y2) / 2)
        side = int(max(x2 - x1, y2 - y1) * np.sqrt(coverage))
        for _ in range(3):
            ang = rng.uniform(0, np.pi)
            dx, dy = np.cos(ang) * side, np.sin(ang) * side
            p1 = (int(cx - dx + rng.integers(-4, 5)), int(cy - dy + rng.integers(-4, 5)))
            p2 = (int(cx + dx + rng.integers(-4, 5)), int(cy + dy + rng.integers(-4, 5)))
            cv2.line(out, p1, p2, (60, 70, 60), max(2, side // 12), cv2.LINE_AA)
            cv2.line(out, p1, p2, (110, 120, 100), max(1, side // 24), cv2.LINE_AA)
    return out


def load_ref_boxes(path: str | None) -> dict[int, list[tuple[float, float, float, float]]]:
    if not path:
        return {}
    boxes: dict[int, list[tuple[float, float, float, float]]] = defaultdict(list)
    with open(path, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            boxes[int(row["frame"])].append(
                (float(row["x1"]), float(row["y1"]), float(row["x2"]), float(row["y2"]))
            )
    return boxes


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--frames", type=int, default=300)
    ap.add_argument("--variants", default="tiny,dark,blur,occlude")
    ap.add_argument("--tiny-scale", type=float, default=0.5)
    ap.add_argument("--ref-csv", default="", help="baseline CSV used to place occluders on real birds")
    ap.add_argument("--start-frame", type=int, default=0)
    args = ap.parse_args(argv)

    variants = [v.strip() for v in args.variants.split(",") if v.strip()]
    if "occlude" in variants and not args.ref_csv:
        print("[warn] occlude needs --ref-csv; skipping occlude", file=sys.stderr)
        variants.remove("occlude")

    ref = load_ref_boxes(args.ref_csv)
    cap, tmp = open_video(args.source)
    if not cap.isOpened():
        print(f"[error] cannot open {args.source}", file=sys.stderr)
        return 2
    meta = video_meta(cap)
    size = (meta["width"], meta["height"])
    fps = meta["fps"] or 25.0
    cap.set(cv2.CAP_PROP_POS_FRAMES, args.start_frame)

    out_dir = Path(args.out_dir).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = Path(args.source).stem

    handles, writers = {}, {}
    for v in variants:
        handle = to_ascii_output(out_dir / f"{stem}_{v}.mp4")
        handles[v] = handle
        writers[v] = make_writer(handle, size, fps)

    frame_idx = args.start_frame
    written = 0
    while written < args.frames:
        ok, frame = cap.read()
        if not ok:
            break
        boxes = ref.get(frame_idx, [])
        for v in variants:
            if v == "tiny":
                out = apply_tiny(frame, args.tiny_scale, size)
            elif v == "dark":
                out = apply_dark(frame)
            elif v == "blur":
                out = motion_blur(frame, 21)
            elif v == "occlude":
                out = apply_occlude(frame, boxes)
            else:
                raise ValueError(f"unknown variant {v}")
            writers[v].write(out)
        written += 1
        frame_idx += 1

    cap.release()
    if tmp is not None:
        tmp.unlink(missing_ok=True)
    for v, w in writers.items():
        w.release()
        handles[v].commit()

    manifest = {
        "source": str(Path(args.source).resolve()),
        "source_meta": meta,
        "start_frame": args.start_frame,
        "frames": written,
        "variants": {v: str((out_dir / f"{stem}_{v}.mp4").resolve()) for v in variants},
        "params": {"tiny_scale": args.tiny_scale, "dark_gain": 0.35, "dark_noise_sigma": 8.0, "blur_kernel": 21, "occlusion_coverage": 0.6},
    }
    (out_dir / f"{stem}_variants.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(manifest, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
