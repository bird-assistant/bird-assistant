"""Render reference vs candidate detections on one frame (report evidence).

    python experiments/inspect_frame.py --source data/videos/V1_feeder_slovakia.webm \
        --frame 227 --ref results/V1/ref_yolo11x_1280_frames.csv \
        --pred results/V1/yolo11n_640_frames.csv --out results/frames/compare_f227.jpg
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

import cv2

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import open_video, to_ascii_output  # noqa: E402


def rows_for(path: str, frame_no: int) -> list[dict]:
    if not path:
        return []
    out = []
    with open(path, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            if int(row["frame"]) == frame_no:
                out.append(row)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", required=True)
    ap.add_argument("--frame", type=int, required=True)
    ap.add_argument("--ref", default="")
    ap.add_argument("--pred", default="")
    ap.add_argument("--out", required=True)
    ap.add_argument("--note", default="")
    args = ap.parse_args(argv)

    cap, tmp = open_video(args.source)
    cap.set(cv2.CAP_PROP_POS_FRAMES, args.frame)
    ok, img = cap.read()
    cap.release()
    if tmp is not None:
        tmp.unlink(missing_ok=True)
    if not ok:
        print(f"[error] cannot read frame {args.frame}", file=sys.stderr)
        return 2

    for r in rows_for(args.ref, args.frame):
        p1 = (int(float(r["x1"])), int(float(r["y1"])))
        p2 = (int(float(r["x2"])), int(float(r["y2"])))
        cv2.rectangle(img, p1, p2, (0, 0, 255), 2)
        cv2.putText(img, f"REF {float(r['conf']):.2f}", (p1[0], max(16, p1[1] - 6)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 255), 2, cv2.LINE_AA)

    for r in rows_for(args.pred, args.frame):
        p1 = (int(float(r["x1"])), int(float(r["y1"])))
        p2 = (int(float(r["x2"])), int(float(r["y2"])))
        cv2.rectangle(img, p1, p2, (0, 255, 0), 2)
        cv2.putText(img, f"N {float(r['conf']):.2f}", (p1[0], min(img.shape[0] - 6, p2[1] + 18)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 0), 2, cv2.LINE_AA)

    if args.note:
        cv2.putText(img, args.note, (12, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 0), 2, cv2.LINE_AA)

    out = to_ascii_output(args.out)
    ext = Path(out.temp).suffix or ".jpg"
    ok = cv2.imwrite(str(out.temp), img, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
    if not ok:
        print("[error] write failed", file=sys.stderr)
        return 3
    out.commit()
    print(f"saved {out.target}  ref_boxes={len(rows_for(args.ref, args.frame))} pred_boxes={len(rows_for(args.pred, args.frame))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
