"""Week-1 visual feasibility harness: detect -> track -> species candidates.

One command produces the annotated video, per-frame CSV and a JSON summary that
carries the device, model, input resolution, fps and latency the review needs.

    python experiments/run_visual_baseline.py \
        --source data/videos/V1_feeder_slovakia.webm \
        --out results/samples/V1_yolo11n_640.mp4 \
        --json results/V1_yolo11n_640.json \
        --csv results/V1_yolo11n_640_frames.csv
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import (  # noqa: E402
    device_info,
    make_writer,
    open_video,
    summarize,
    to_ascii_output,
    video_meta,
    write_json,
)

COCO_BIRD = 14


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    p.add_argument("--source", required=True, help="video path or webcam index (e.g. 0)")
    p.add_argument("--model", default="yolo11n.pt", help="ultralytics detection weights")
    p.add_argument("--imgsz", type=int, default=640)
    p.add_argument("--conf", type=float, default=0.25)
    p.add_argument("--iou", type=float, default=0.5)
    p.add_argument("--classes", default=str(COCO_BIRD), help="comma separated class ids, or 'all'")
    p.add_argument("--tracker", default="bytetrack", choices=["none", "bytetrack", "botsort"])
    p.add_argument("--cls-model", default="none", choices=["none", "resnet50", "efficientnet_b0"])
    p.add_argument("--topk", type=int, default=5)
    p.add_argument("--max-frames", type=int, default=0, help="0 = whole video")
    p.add_argument("--loop", type=int, default=1, help="repeat the video N times (steady-state timing)")
    p.add_argument("--warmup", type=int, default=5, help="frames excluded from latency stats")
    p.add_argument("--device", default="cpu")
    p.add_argument("--threads", type=int, default=0, help="torch threads, 0 = leave default")
    p.add_argument("--out", default="", help="annotated mp4 path")
    p.add_argument("--json", default="", help="summary json path")
    p.add_argument("--csv", default="", help="per-detection csv path")
    p.add_argument("--snapshots", type=int, default=0, help="save N annotated stills in results/frames")
    p.add_argument("--quiet", action="store_true")
    return p


def parse_classes(raw: str):
    if raw.strip().lower() == "all":
        return None
    return [int(x) for x in raw.split(",") if x.strip() != ""]


def clip_box(box, w: int, h: int, pad: float = 0.15):
    x1, y1, x2, y2 = box
    bw, bh = x2 - x1, y2 - y1
    x1 = max(0.0, x1 - bw * pad)
    y1 = max(0.0, y1 - bh * pad)
    x2 = min(float(w), x2 + bw * pad)
    y2 = min(float(h), y2 + bh * pad)
    return int(x1), int(y1), int(x2), int(y2)


def color_for(track_id: int):
    if track_id is None:
        return (0, 215, 255)
    rng = np.random.RandomState(int(track_id) * 9973 % 2**31)
    return tuple(int(v) for v in rng.randint(60, 255, size=3))


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)

    import torch
    from ultralytics import YOLO

    if args.threads > 0:
        torch.set_num_threads(args.threads)

    cap, tmp_copy = open_video(args.source)
    if not cap.isOpened():
        print(f"[error] cannot open source: {args.source}", file=sys.stderr)
        return 2
    meta = video_meta(cap)
    src_fps = meta["fps"] or 25.0
    width, height = meta["width"], meta["height"]

    model = YOLO(args.model)
    names = model.names
    class_filter = parse_classes(args.classes)

    species = None
    if args.cls_model != "none":
        from species_classifier import ImageNetBirdClassifier

        species = ImageNetBirdClassifier(args.cls_model, device=args.device)

    writer, out_handle = None, None
    if args.out:
        out_handle = to_ascii_output(args.out)
        writer = make_writer(out_handle, (width, height), src_fps)

    rows: list[dict] = []
    timings = defaultdict(list)
    tracks: dict[int, dict] = defaultdict(lambda: {"frames": 0, "first": None, "last": None, "conf": [], "votes": None})
    box_sides: list[float] = []
    frames_with_bird = 0
    total_dets = 0
    species_skipped = 0
    snapshot_every = 0
    snapshots_saved = 0

    total_target = args.max_frames if args.max_frames > 0 else meta["frames"] * args.loop
    if total_target <= 0:
        total_target = 10**9
    if args.snapshots > 0:
        snapshot_every = max(1, total_target // max(1, args.snapshots))

    processed = 0
    frame_idx = 0
    loop_i = 0
    wall_start = time.perf_counter()

    while processed < total_target:
        t0 = time.perf_counter()
        ok, frame = cap.read()
        if not ok:
            loop_i += 1
            if loop_i >= args.loop:
                break
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            if args.tracker != "none" and getattr(model, "predictor", None) is not None:
                for trk in getattr(model.predictor, "trackers", []) or []:
                    trk.reset()
            continue
        t_read = time.perf_counter()

        if args.tracker == "none":
            res = model.predict(
                frame, imgsz=args.imgsz, conf=args.conf, iou=args.iou,
                classes=class_filter, device=args.device, verbose=False,
            )[0]
        else:
            res = model.track(
                frame, persist=True, tracker=f"{args.tracker}.yaml", imgsz=args.imgsz,
                conf=args.conf, iou=args.iou, classes=class_filter,
                device=args.device, verbose=False,
            )[0]
        t_infer = time.perf_counter()

        boxes = res.boxes
        n_det = 0 if boxes is None else len(boxes)
        if boxes is not None and boxes.id is not None:
            ids = boxes.id.int().tolist()
        else:
            ids = [None] * n_det

        crops, crop_meta = [], []
        det_rows = []
        if n_det:
            xyxy = boxes.xyxy.cpu().numpy()
            confs = boxes.conf.cpu().numpy()
            for i in range(n_det):
                x1, y1, x2, y2 = (float(v) for v in xyxy[i])
                side = max(x2 - x1, y2 - y1)
                box_sides.append(side)
                tid = ids[i] if i < len(ids) else None
                det_rows.append({"track_id": tid, "conf": float(confs[i]), "box": (x1, y1, x2, y2), "side": side, "species": [], "prob": None})
                if species is not None:
                    cx1, cy1, cx2, cy2 = clip_box((x1, y1, x2, y2), width, height)
                    if (cx2 - cx1) >= 32 and (cy2 - cy1) >= 32:
                        crops.append(frame[cy1:cy2, cx1:cx2])
                        crop_meta.append(len(det_rows) - 1)
                    else:
                        species_skipped += 1

        if species is not None and crops:
            preds = species.predict(crops, topk=args.topk)
            for det_index, top in zip(crop_meta, preds):
                det_rows[det_index]["species"] = top
                det_rows[det_index]["prob"] = top[0][1]
                tid = det_rows[det_index]["track_id"]
                if tid is not None:
                    agg = tracks[tid]["votes"]
                    if agg is None:
                        agg = tracks[tid]["votes"] = defaultdict(float)
                    for name, p in top:
                        agg[name] += p

        t_species = time.perf_counter()

        if n_det:
            frames_with_bird += 1
            total_dets += n_det

        for det in det_rows:
            tid = det["track_id"]
            if tid is not None:
                t = tracks[tid]
                t["frames"] += 1
                t["conf"].append(det["conf"])
                if t["first"] is None:
                    t["first"] = frame_idx
                t["last"] = frame_idx

            if writer is not None:
                x1, y1, x2, y2 = (int(round(v)) for v in det["box"])
                color = color_for(tid)
                cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
                label = f"bird {det['conf']:.2f}"
                if tid is not None:
                    label = f"#{tid} " + label
                if det["species"]:
                    label += f" | {det['species'][0][0]} {det['species'][0][1]:.2f}"
                cv2.putText(frame, label, (x1, max(12, y1 - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1, cv2.LINE_AA)

            if processed >= args.warmup:
                rows.append(
                    {
                        "frame": frame_idx,
                        "track_id": "" if tid is None else tid,
                        "conf": round(det["conf"], 4),
                        "x1": round(det["box"][0], 1),
                        "y1": round(det["box"][1], 1),
                        "x2": round(det["box"][2], 1),
                        "y2": round(det["box"][3], 1),
                        "side_px": round(det["side"], 1),
                        "species_top1": det["species"][0][0] if det["species"] else "",
                        "species_prob": round(det["prob"], 4) if det["prob"] is not None else "",
                        "species_topk": json.dumps(det["species"]) if det["species"] else "",
                    }
                )

        if writer is not None:
            writer.write(frame)

        t_end = time.perf_counter()

        if processed >= args.warmup:
            timings["read_ms"].append((t_read - t0) * 1000)
            timings["infer_wall_ms"].append((t_infer - t_read) * 1000)
            timings["species_ms"].append((t_species - t_infer) * 1000)
            timings["proc_ms"].append((t_end - t_read) * 1000)
            timings["e2e_ms"].append((t_end - t0) * 1000)
            speeds = getattr(res, "speed", {}) or {}
            for key in ("preprocess", "inference", "postprocess"):
                if key in speeds:
                    timings[f"model_{key}_ms"].append(float(speeds[key]))

        if args.snapshots > 0 and snapshot_every and processed % snapshot_every == 0 and snapshots_saved < args.snapshots:
            if writer is not None:
                snap_dir = Path("results/frames")
                snap_dir.mkdir(parents=True, exist_ok=True)
                cv2.imwrite(str(snap_dir / f"{Path(args.out).stem}_f{frame_idx:05d}.jpg"), frame)
                snapshots_saved += 1

        processed += 1
        frame_idx += 1
        if not args.quiet and processed % 50 == 0:
            print(f"  ... {processed}/{total_target} frames", flush=True)

    wall = time.perf_counter() - wall_start
    cap.release()
    if writer is not None:
        writer.release()
        out_handle.commit()
    if tmp_copy is not None:
        tmp_copy.unlink(missing_ok=True)

    if args.csv and rows:
        csv_path = Path(args.csv).expanduser().resolve()
        csv_path.parent.mkdir(parents=True, exist_ok=True)
        with csv_path.open("w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)

    track_summary = []
    for tid, t in sorted(tracks.items(), key=lambda kv: -kv[1]["frames"])[:50]:
        entry = {
            "track_id": tid,
            "frames_seen": t["frames"],
            "first_frame": t["first"],
            "last_frame": t["last"],
            "mean_conf": round(float(np.mean(t["conf"])), 3),
            "span_frames": (t["last"] - t["first"] + 1) if t["first"] is not None else 0,
        }
        if t["votes"]:
            top = sorted(t["votes"].items(), key=lambda kv: -kv[1])[: args.topk]
            total = sum(t["votes"].values()) or 1.0
            entry["species_candidates"] = [[n, round(v / total, 4)] for n, v in top]
        track_summary.append(entry)

    stats = {
        "meta": meta,
        "source": str(Path(args.source).resolve()),
        "device_info": device_info(),
        "config": {
            "model": args.model,
            "imgsz": args.imgsz,
            "conf": args.conf,
            "iou": args.iou,
            "classes": args.classes,
            "tracker": args.tracker,
            "cls_model": args.cls_model,
            "topk": args.topk,
            "device_arg": args.device,
            "loops": args.loop,
            "warmup": args.warmup,
        },
        "run": {
            "frames_processed": processed,
            "frames_in_stats": len(timings["e2e_ms"]),
            "wall_s": round(wall, 2),
            "fps_processed": round(processed / wall, 2) if wall else None,
            "source_fps": src_fps,
            "realtime_factor": round((processed / wall) / src_fps, 3) if wall and src_fps else None,
        },
        "detections": {
            "total": total_dets,
            "frames_with_bird": frames_with_bird,
            "frame_hit_rate": round(frames_with_bird / processed, 4) if processed else None,
            "mean_per_frame": round(total_dets / processed, 3) if processed else None,
            "box_side_px": summarize(box_sides),
            "box_side_bins": {
                "<32": sum(1 for s in box_sides if s < 32),
                "32-64": sum(1 for s in box_sides if 32 <= s < 64),
                "64-128": sum(1 for s in box_sides if 64 <= s < 128),
                ">=128": sum(1 for s in box_sides if s >= 128),
            },
        },
        "tracking": {
            "unique_ids": len(tracks),
            "tracks_ge_5_frames": sum(1 for t in tracks.values() if t["frames"] >= 5),
            "tracks_ge_30_frames": sum(1 for t in tracks.values() if t["frames"] >= 30),
            "id_assignment_rate": round(sum(1 for r in rows if r["track_id"] != "") / len(rows), 4) if rows else None,
            "per_track": track_summary,
        },
        "species": {
            "enabled": species is not None,
            "model": args.cls_model,
            "skipped_small_crops": species_skipped,
            "top1_histogram": dict(Counter(r["species_top1"] for r in rows if r["species_top1"]).most_common(20)),
        },
        "latency_ms": {k: summarize(v) for k, v in sorted(timings.items())},
        "outputs": {
            "video": str(Path(args.out).resolve()) if args.out else None,
            "csv": str(Path(args.csv).resolve()) if args.csv and rows else None,
            "json": str(Path(args.json).resolve()) if args.json else None,
        },
    }

    if args.json:
        write_json(args.json, stats)

    if not args.quiet:
        lat = stats["latency_ms"].get("e2e_ms", {})
        print(json.dumps({
            "frames_processed": processed,
            "fps_processed": stats["run"]["fps_processed"],
            "realtime_factor": stats["run"]["realtime_factor"],
            "e2e_p50_ms": lat.get("p50"),
            "e2e_p95_ms": lat.get("p95"),
            "infer_p50_ms": stats["latency_ms"].get("model_inference_ms", {}).get("p50"),
            "frames_with_bird": f"{frames_with_bird}/{processed}",
            "unique_track_ids": len(tracks),
            "box_side_bins": stats["detections"]["box_side_bins"],
        }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
