"""Engines behind the test GUI: video/screen vision, audio analysis.

Kept separate from experiments/run_*_baseline.py so the CLI reproduces the
report numbers unchanged; this module is the interactive front end over the
same models and the same preprocessing.
"""

from __future__ import annotations

import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

from paths import model_path as default_model_path
from paths import resource_dir  # noqa: E402

REPO = resource_dir()
sys.path.insert(0, str(REPO / "experiments"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import to_ascii_input  # noqa: E402

VIDEO_EXTS = (".mp4", ".avi", ".mov", ".mkv", ".webm", ".flv", ".m4v", ".ts", ".wmv", ".mpg", ".mpeg")
AUDIO_EXTS = (".wav", ".mp3", ".ogg", ".oga", ".flac", ".m4a", ".aac", ".opus", ".wma", ".amr")
COCO_BIRD = 14
AUDIO_SR = 48000


# --------------------------------------------------------------------------- #
# vision
# --------------------------------------------------------------------------- #
@dataclass
class Detection:
    track_id: int | None
    conf: float
    xyxy: tuple[float, float, float, float]
    side_px: float
    species: list[tuple[str, float]] = field(default_factory=list)


@dataclass
class FrameResult:
    detections: list[Detection]
    infer_ms: float
    species_ms: float
    total_ms: float


class VisualEngine:
    """detect -> track -> (optional) species candidates on a single BGR frame."""

    def __init__(
        self,
        model_path: str | Path | None = None,
        imgsz: int = 640,
        conf: float = 0.25,
        iou: float = 0.5,
        track: bool = True,
        cls_model: str = "none",
        topk: int = 5,
        device: str = "cpu",
        threads: int = 0,
    ):
        import torch
        from ultralytics import YOLO

        if threads > 0:
            torch.set_num_threads(threads)
        self.model = YOLO(str(model_path or default_model_path()))
        self.imgsz, self.conf, self.iou = imgsz, conf, iou
        self.track = track
        self.device = device
        self.topk = topk
        self.cls_model = cls_model
        self.classifier = None
        if cls_model != "none":
            from species_classifier import ImageNetBirdClassifier

            self.classifier = ImageNetBirdClassifier(cls_model, device=device)
        self.votes: dict[int, dict[str, float]] = {}
        self.frames = 0
        self.detections_total = 0
        self.skipped_small = 0

    def reset_tracker(self) -> None:
        predictor = getattr(self.model, "predictor", None)
        for trk in getattr(predictor, "trackers", None) or []:
            trk.reset()
        self.votes.clear()
        self.frames = 0
        self.detections_total = 0
        self.skipped_small = 0

    def infer(self, frame: np.ndarray) -> FrameResult:
        t0 = time.perf_counter()
        if self.track:
            res = self.model.track(
                frame, persist=True, tracker="bytetrack.yaml", imgsz=self.imgsz,
                conf=self.conf, iou=self.iou, classes=[COCO_BIRD],
                device=self.device, verbose=False,
            )[0]
        else:
            res = self.model.predict(
                frame, imgsz=self.imgsz, conf=self.conf, iou=self.iou,
                classes=[COCO_BIRD], device=self.device, verbose=False,
            )[0]
        t_infer = time.perf_counter()

        boxes = res.boxes
        n = 0 if boxes is None else len(boxes)
        ids = boxes.id.int().tolist() if (boxes is not None and boxes.id is not None) else [None] * n
        dets: list[Detection] = []
        crops, crop_idx = [], []

        if n:
            xyxy = boxes.xyxy.cpu().numpy()
            confs = boxes.conf.cpu().numpy()
            h, w = frame.shape[:2]
            for i in range(n):
                x1, y1, x2, y2 = (float(v) for v in xyxy[i])
                det = Detection(ids[i] if i < len(ids) else None, float(confs[i]), (x1, y1, x2, y2), max(x2 - x1, y2 - y1))
                dets.append(det)
                if self.classifier is not None:
                    bw, bh = x2 - x1, y2 - y1
                    cx1, cy1 = int(max(0, x1 - bw * 0.15)), int(max(0, y1 - bh * 0.15))
                    cx2, cy2 = int(min(w, x2 + bw * 0.15)), int(min(h, y2 + bh * 0.15))
                    if cx2 - cx1 >= 32 and cy2 - cy1 >= 32:
                        crops.append(frame[cy1:cy2, cx1:cx2])
                        crop_idx.append(i)
                    else:
                        self.skipped_small += 1

        if crops:
            preds = self.classifier.predict(crops, topk=self.topk)
            for i, top in zip(crop_idx, preds):
                dets[i].species = top
                tid = dets[i].track_id
                if tid is not None:
                    bucket = self.votes.setdefault(tid, {})
                    for name, p in top:
                        bucket[name] = bucket.get(name, 0.0) + p

        t_species = time.perf_counter()
        self.frames += 1
        self.detections_total += n
        return FrameResult(dets, (t_infer - t0) * 1000, (t_species - t_infer) * 1000, (t_species - t0) * 1000)

    def track_candidates(self, track_id: int, k: int = 3) -> list[tuple[str, float]]:
        votes = self.votes.get(track_id)
        if not votes:
            return []
        total = sum(votes.values()) or 1.0
        return [(n, v / total) for n, v in sorted(votes.items(), key=lambda kv: -kv[1])[:k]]


def color_for(track_id: int | None) -> tuple[int, int, int]:
    if track_id is None:
        return (0, 215, 255)
    rng = np.random.RandomState(int(track_id) * 9973 % 2**31)
    return tuple(int(v) for v in rng.randint(70, 255, size=3))


def draw(frame: np.ndarray, result: FrameResult) -> np.ndarray:
    out = frame.copy()
    for det in result.detections:
        x1, y1, x2, y2 = (int(round(v)) for v in det.xyxy)
        color = color_for(det.track_id)
        cv2.rectangle(out, (x1, y1), (x2, y2), color, 2)
        label = f"bird {det.conf:.2f}"
        if det.track_id is not None:
            label = f"#{det.track_id} " + label
        if det.species:
            label += f" | {det.species[0][0]} {det.species[0][1]:.2f}"
        cv2.putText(out, label, (x1, max(14, y1 - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1, cv2.LINE_AA)
    return out


# --------------------------------------------------------------------------- #
# sources
# --------------------------------------------------------------------------- #
class VideoSource:
    def __init__(self, path: str | Path):
        self.safe_path, self._tmp = to_ascii_input(str(path))
        self.cap = cv2.VideoCapture(str(self.safe_path))
        if not self.cap.isOpened():
            raise RuntimeError(f"无法打开视频：{path}")
        self.fps = float(self.cap.get(cv2.CAP_PROP_FPS) or 25.0)
        self.width = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        self.height = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        self.frames = int(self.cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        self.index = 0

    def read(self):
        ok, frame = self.cap.read()
        if not ok:
            return None
        self.index += 1
        return frame

    def release(self):
        self.cap.release()
        if self._tmp is not None:
            self._tmp.unlink(missing_ok=True)


class ScreenSource:
    """Grab a fixed screen rectangle at a target fps (create inside the worker thread)."""

    def __init__(self, region: tuple[int, int, int, int], target_fps: float = 15.0):
        import mss

        self.left, self.top, self.width, self.height = (int(v) for v in region)
        if self.width <= 1 or self.height <= 1:
            raise ValueError("选区太小")
        self.interval = 1.0 / max(1.0, float(target_fps))
        self._next = time.perf_counter()
        self._sct = mss.mss()
        self.monitor = {"left": self.left, "top": self.top, "width": self.width, "height": self.height}

    def read(self):
        wait = self._next - time.perf_counter()
        if wait > 0:
            time.sleep(wait)
        self._next = max(self._next + self.interval, time.perf_counter())
        shot = self._sct.grab(self.monitor)
        return cv2.cvtColor(np.asarray(shot), cv2.COLOR_BGRA2BGR)

    def release(self):
        try:
            self._sct.close()
        except Exception:
            pass


# --------------------------------------------------------------------------- #
# audio
# --------------------------------------------------------------------------- #
def decode_audio_48k(path: str | Path) -> np.ndarray:
    """Any format ffmpeg understands -> 48 kHz mono float32."""
    try:
        import imageio_ffmpeg

        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        raw = subprocess.run(
            [ffmpeg, "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", str(AUDIO_SR), "-"],
            capture_output=True, check=True,
        ).stdout
        data = np.frombuffer(raw, dtype=np.float32).copy()
        if data.size == 0:
            raise RuntimeError("解码结果为空")
        return data
    except Exception:
        import soundfile as sf

        data, sr = sf.read(str(path), dtype="float32", always_2d=True)
        x = data.mean(axis=1) if data.ndim > 1 else data
        if sr != AUDIO_SR:
            from scipy.signal import resample_poly

            x = resample_poly(x, AUDIO_SR, sr)
        return x.astype(np.float32)


class AudioEngine:
    def __init__(self, threads: int = 4):
        from birdnet_runtime import BirdNet

        self.net = BirdNet(threads=threads)
        self.threads = threads

    def analyze(self, path: str | Path, window: float = 3.0, hop: float = 1.5, topk: int = 5) -> dict:
        from audio_lib import analyze as run_analyze

        t0 = time.perf_counter()
        x = decode_audio_48k(path)
        load_ms = (time.perf_counter() - t0) * 1000
        result = run_analyze(self.net, x, window, hop, topk=topk)
        lat = [w["latency_ms"] for w in result["windows"]]
        return {
            "file": Path(path).name,
            "audio_s": round(len(x) / AUDIO_SR, 2),
            "window_s": window,
            "hop_s": hop,
            "windows": len(result["windows"]),
            "aggregate": result["aggregate"],
            "per_window": result["windows"],
            "load_ms": round(load_ms, 1),
            "latency_p50": round(float(np.percentile(lat, 50)), 2) if lat else None,
            "latency_p95": round(float(np.percentile(lat, 95)), 2) if lat else None,
        }


def _selftest() -> int:
    """Headless check of both engines: python app/engines.py --video ... --audio ..."""
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--video", default=str(REPO / "data/videos/V1_feeder_slovakia.webm"))
    ap.add_argument("--audio", default=str(REPO / "data/audio/wav/A1_blackbird.wav"))
    ap.add_argument("--frames", type=int, default=60)
    ap.add_argument("--cls", default="resnet50")
    ap.add_argument("--screen", default="", help="例如 100,100,640,360：采集屏幕区域做一次快速验证")
    args = ap.parse_args()

    if args.screen:
        left, top, w, h = (int(v) for v in args.screen.split(","))
        src = ScreenSource((left, top, w, h), target_fps=10)
        eng = VisualEngine(model_path=default_model_path(), cls_model=args.cls)
        lat = []
        for _ in range(8):
            frame = src.read()
            t0 = time.perf_counter()
            res = eng.infer(frame)
            lat.append((time.perf_counter() - t0) * 1000)
            draw(frame, res)
        src.release()
        print(f"screen: {w}x{h} grabbed=8 dets={eng.detections_total} "
              f"p50={np.percentile(lat, 50):.1f}ms frame_shape={frame.shape}")
        return 0

    src = VideoSource(args.video)
    print(f"video {src.width}x{src.height} @{src.fps:.2f}fps frames={src.frames}")
    eng = VisualEngine(model_path=default_model_path(), cls_model=args.cls)
    totals, dets = [], 0
    for _ in range(args.frames):
        frame = src.read()
        if frame is None:
            break
        res = eng.infer(frame)
        totals.append(res.total_ms)
        dets += len(res.detections)
        draw(frame, res)
    src.release()
    if totals:
        print(f"vision: frames={len(totals)} dets={dets} p50={np.percentile(totals, 50):.1f}ms "
              f"p95={np.percentile(totals, 95):.1f}ms")

    audio = AudioEngine()
    out = audio.analyze(args.audio)
    top = out["aggregate"][0]
    print(f"audio: {out['file']} {out['audio_s']}s windows={out['windows']} "
          f"top1={top[0]} p={top[1]:.3f} p50={out['latency_p50']}ms p95={out['latency_p95']}ms")
    return 0


if __name__ == "__main__":
    raise SystemExit(_selftest())

