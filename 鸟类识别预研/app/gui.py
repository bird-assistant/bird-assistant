"""Tkinter test bench: video file / screen region / audio file, plus a checklist.

    python app/gui.py

Everything runs on CPU with the same models as experiments/, so numbers here are
directly comparable with the report.
"""

from __future__ import annotations

import ctypes
import json
import queue
import sys
import threading
import time
import tkinter as tk
from collections import deque
from datetime import datetime
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

import cv2
import numpy as np
from PIL import Image, ImageTk

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(REPO / "experiments"))

from engines import (  # noqa: E402
    AUDIO_EXTS,
    VIDEO_EXTS,
    AudioEngine,
    ScreenSource,
    VideoSource,
    VisualEngine,
    draw,
)
from paths import model_path, resolve_input, results_dir, setup_env  # noqa: E402

CANVAS_W, CANVAS_H = 800, 450


def enable_dpi_awareness() -> None:
    """Make Tk and mss agree on physical pixels, otherwise region capture is offset."""
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except Exception:
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except Exception:
            pass


def log_line(text: str) -> None:
    """Print and also append to results/gui/selftest.log (windowed builds have no stdout)."""
    print(text, flush=True)
    try:
        d = results_dir()
        d.mkdir(parents=True, exist_ok=True)
        with (d / "selftest.log").open("a", encoding="utf-8") as fh:
            fh.write(f"{datetime.now():%Y-%m-%d %H:%M:%S}  {text}\n")
    except Exception:
        pass


def fmt_pct(values: deque, q: float) -> str:
    if not values:
        return "-"
    return f"{float(np.percentile(np.asarray(values, dtype=float), q)):.1f}"


class VisionPanel(ttk.Frame):
    """Video-file and screen-region modes share everything except the source."""

    def __init__(self, master, app: "BirdLabApp", mode: str):
        super().__init__(master, padding=8)
        self.app = app
        self.mode = mode
        self.columnconfigure(0, weight=1)
        self.rowconfigure(2, weight=1)
        self.engine: VisualEngine | None = None
        self.thread: threading.Thread | None = None
        self.stop_event = threading.Event()
        self.q: queue.Queue = queue.Queue(maxsize=2)
        self.latencies: deque[float] = deque(maxlen=200)
        self.infer_latencies: deque[float] = deque(maxlen=200)
        self.region: tuple[int, int, int, int] | None = None
        self.video_path: Path | None = None
        self.seen_ids: set[int] = set()
        self.processed = 0
        self.last_frame_time = 0.0
        self._photo: ImageTk.PhotoImage | None = None
        self._ts: deque[float] = deque(maxlen=30)
        self._last_candidates = ""
        self._fps_ema = 0.0
        self._build()
        self.after(30, self._poll)

    # ---------------- layout ---------------- #
    def _build(self) -> None:
        bar = ttk.Frame(self)
        bar.grid(row=0, column=0, columnspan=2, sticky="ew", pady=(0, 4))
        if self.mode == "video":
            ttk.Button(bar, text="选择视频…", command=self.pick_video).pack(side="left")
            self.source_label = ttk.Label(bar, text="未选择文件", foreground="#555")
            self.source_label.pack(side="left", padx=8)
        else:
            ttk.Button(bar, text="框选屏幕区域…", command=self.pick_region).pack(side="left")
            self.source_label = ttk.Label(bar, text="未选择区域", foreground="#555")
            self.source_label.pack(side="left", padx=8)

        self.start_btn = ttk.Button(bar, text="开始", width=8, command=self.start)
        self.start_btn.pack(side="right")
        self.stop_btn = ttk.Button(bar, text="停止", width=8, command=self.stop, state="disabled")
        self.stop_btn.pack(side="right", padx=6)

        params = ttk.Frame(self)
        params.grid(row=1, column=0, columnspan=2, sticky="ew", pady=(0, 6))
        if self.mode == "screen":
            ttk.Label(params, text="采集 FPS").pack(side="left")
            self.fps_var = tk.StringVar(value="15")
            ttk.Combobox(params, textvariable=self.fps_var, values=["5", "10", "15", "30"], width=4, state="readonly").pack(side="left", padx=(2, 14))

        ttk.Label(params, text="imgsz").pack(side="left")
        self.imgsz_var = tk.StringVar(value="640")
        ttk.Combobox(params, textvariable=self.imgsz_var, values=["640", "960", "1280"], width=6, state="readonly").pack(side="left", padx=(2, 14))

        ttk.Label(params, text="conf").pack(side="left")
        self.conf_var = tk.StringVar(value="0.25")
        ttk.Spinbox(params, textvariable=self.conf_var, from_=0.05, to=0.9, increment=0.05, width=5).pack(side="left", padx=(2, 14))

        ttk.Label(params, text="分类模型").pack(side="left")
        self.cls_var = tk.StringVar(value="resnet50")
        ttk.Combobox(params, textvariable=self.cls_var, values=["none", "resnet50", "efficientnet_b0"], width=15, state="readonly").pack(side="left", padx=(2, 14))

        ttk.Label(params, text="跳帧").pack(side="left")
        self.stride_var = tk.StringVar(value="1")
        ttk.Spinbox(params, textvariable=self.stride_var, from_=1, to=10, width=4).pack(side="left", padx=(2, 14))

        ttk.Label(params, text="（框短边 ≥64px 才给物种）", foreground="#888").pack(side="left")

        self.canvas = tk.Canvas(self, width=680, height=382, bg="#111", highlightthickness=0)
        self.canvas.grid(row=2, column=0, sticky="nsew", padx=(0, 8))
        self.canvas.create_text(340, 191, text="等待开始", fill="#777", font=("Microsoft YaHei UI", 12), tags="hint")

        side = ttk.Frame(self, width=360)
        side.grid(row=2, column=1, sticky="ns")
        side.grid_propagate(False)

        self.stat_labels: dict[str, ttk.Label] = {}
        for key, label in [
            ("src", "源"),
            ("frames", "已处理帧"),
            ("fps", "预览 FPS"),
            ("lat", "p50 / p95"),
            ("det", "目标数 / 唯一ID"),
            ("hint", "提示"),
        ]:
            row = ttk.Frame(side)
            row.pack(fill="x", pady=1)
            ttk.Label(row, text=label, width=15, foreground="#666").pack(side="left")
            value = ttk.Label(row, text="-", wraplength=200, justify="left")
            value.pack(side="left")
            self.stat_labels[key] = value

        ttk.Separator(side).pack(fill="x", pady=6)
        ttk.Label(side, text="候选物种（按 track 聚合）", foreground="#666").pack(anchor="w")
        self.cand_text = tk.Text(side, height=14, width=40, wrap="word", font=("Consolas", 9))
        self.cand_text.pack(fill="both", expand=True, pady=(4, 6))

        ttk.Button(side, text="导出本次结果 JSON", command=self.export).pack(fill="x")
        self.status = ttk.Label(self, text="就绪", foreground="#2a7")
        self.status.grid(row=3, column=0, columnspan=2, sticky="w", pady=(6, 0))

    # ---------------- sources ---------------- #
    def pick_video(self) -> None:
        patterns = " ".join(f"*{e}" for e in VIDEO_EXTS)
        path = filedialog.askopenfilename(title="选择视频", filetypes=[("视频文件", patterns), ("所有文件", "*.*")])
        if path:
            self.video_path = Path(path)
            self.source_label.config(text=self.video_path.name, foreground="#000")

    def pick_region(self) -> None:
        region = select_region(self.winfo_toplevel())
        if region:
            self.region = region
            x, y, w, h = region
            self.source_label.config(text=f"({x},{y}) {w}×{h}", foreground="#000")

    # ---------------- run loop ---------------- #
    def start(self) -> None:
        if self.thread and self.thread.is_alive():
            return
        if self.mode == "video" and not self.video_path:
            messagebox.showinfo("提示", "先选择一个视频文件")
            return
        if self.mode == "screen" and not self.region:
            messagebox.showinfo("提示", "先框选一块屏幕区域")
            return

        self.app.stop_all(except_panel=self)
        self.stop_event.clear()
        self.latencies.clear()
        self.infer_latencies.clear()
        self.seen_ids.clear()
        self.processed = 0
        self.last_frame_time = 0.0
        self._fps_ema = 0.0
        self._last_candidates = ""
        while not self.q.empty():
            self.q.get_nowait()
        self.start_btn.config(state="disabled")
        self.stop_btn.config(state="normal")
        self.status.config(text="加载模型中…", foreground="#c60")

        # Tk variables may only be read on the main thread.
        cfg = {
            "imgsz": int(self.imgsz_var.get()),
            "conf": float(self.conf_var.get()),
            "cls_model": self.cls_var.get(),
            "stride": max(1, int(float(self.stride_var.get()))),
            "fps": float(self.fps_var.get()) if self.mode == "screen" else None,
            "video": self.video_path,
            "region": self.region,
        }
        self.thread = threading.Thread(target=self._worker, args=(cfg,), daemon=True)
        self.thread.start()

    def stop(self) -> None:
        self.stop_event.set()
        self.status.config(text="正在停止…", foreground="#c60")

    def _worker(self, cfg: dict) -> None:
        src = None
        try:
            if self.mode == "video":
                log_line(f"INFO source={cfg['video']}")
                src = VideoSource(cfg["video"])
                src_desc = f"{src.width}×{src.height} @ {src.fps:.1f}fps"
            else:
                src = ScreenSource(cfg["region"], target_fps=cfg["fps"])
                src_desc = f"屏幕 {src.width}×{src.height} @ {cfg['fps']:g}fps"

            log_line(f"INFO loading model imgsz={cfg['imgsz']} cls={cfg['cls_model']}")
            self.engine = VisualEngine(
                model_path=model_path(),
                imgsz=cfg["imgsz"],
                conf=cfg["conf"],
                cls_model=cfg["cls_model"],
            )
            self.q.put(("status", f"运行中 · {src_desc}"))
            stride = cfg["stride"]
            interval = 1.0 / src.fps if self.mode == "video" else 0.0
            next_t = time.perf_counter()
            idx = 0

            while not self.stop_event.is_set():
                frame = src.read()
                if frame is None:
                    break
                if idx % stride:
                    idx += 1
                    continue
                idx += 1

                if interval:
                    wait = next_t - time.perf_counter()
                    if wait > 0:
                        time.sleep(wait)
                    next_t = max(next_t + interval, time.perf_counter())

                t0 = time.perf_counter()
                res = self.engine.infer(frame)
                vis = draw(frame, res)
                self.q.put(("frame", (vis, res, (time.perf_counter() - t0) * 1000, self.engine)))
                if self.stop_event.is_set():
                    break
            self.q.put(("done", "结束"))
        except Exception as exc:  # noqa: BLE001
            self.q.put(("error", f"{type(exc).__name__}: {exc}"))
        finally:
            if src is not None:
                try:
                    src.release()
                except Exception:
                    pass

    # ---------------- ui pump ---------------- #
    def _poll(self) -> None:
        try:
            while True:
                kind, payload = self.q.get_nowait()
                if kind == "frame":
                    self._on_frame(*payload)
                elif kind == "status":
                    self.status.config(text=payload, foreground="#2a7")
                elif kind == "done":
                    self._finish("运行结束")
                elif kind == "error":
                    log_line(f"ERROR[{self.mode}] {payload}")
                    self._finish(f"出错：{payload}", error=True)
        except queue.Empty:
            pass
        self.after(30, self._poll)
    def _on_frame(self, vis, res, total_ms: float, engine: VisualEngine) -> None:
        now = time.perf_counter()
        self.last_frame_time = now
        if self.processed:
            self.latencies.append(total_ms)
            self.infer_latencies.append(res.infer_ms)
        self.processed += 1
        for det in res.detections:
            if det.track_id is not None:
                self.seen_ids.add(det.track_id)

        self._show_image(vis)
        if self.processed > 1:
            self._ts.append(now)
        fps = 0.0
        if len(self._ts) >= 2:
            span = self._ts[-1] - self._ts[0]
            fps = (len(self._ts) - 1) / span if span > 0 else 0.0
        self.stat_labels["src"].config(text=f"{vis.shape[1]}×{vis.shape[0]}")
        self.stat_labels["frames"].config(text=f"{self.processed}")
        self.stat_labels["fps"].config(text=f"{fps:.1f}（推理 {res.infer_ms:.1f} ms）")
        self.stat_labels["lat"].config(
            text=f"{fmt_pct(self.latencies, 50)} / {fmt_pct(self.latencies, 95)} ms"
        )
        self.stat_labels["det"].config(text=f"{len(res.detections)} / {len(self.seen_ids)}")
        self.stat_labels["hint"].config(
            text="框短边 ≥64px 才给物种" if self.cls_var.get() != "none" else "未启用物种分类"
        )
        self._show_candidates(engine, res)

    def _show_candidates(self, engine: VisualEngine, res) -> None:
        ids = [d.track_id for d in res.detections if d.track_id is not None]
        if ids:
            lines = []
            for tid in dict.fromkeys(ids):
                cands = engine.track_candidates(tid, k=3)
                if not cands:
                    lines.append(f"#{tid}  （无物种候选：框太小或未启用）")
                    continue
                lines.append(f"#{tid}")
                for name, p in cands:
                    lines.append(f"   {name[:26]:<26} {p:.3f}")
            self._last_candidates = "\n".join(lines)
        else:
            # Single-frame misses are normal; keep the last known result visible.
            lines = ["（当前帧没有检测到鸟）", ""]
            lines.append(self._last_candidates or "尚无候选")
        self.cand_text.delete("1.0", "end")
        self.cand_text.insert("1.0", "\n".join(lines))

    def _show_image(self, bgr) -> None:
        h, w = bgr.shape[:2]
        cw = self.canvas.winfo_width() or CANVAS_W
        ch = self.canvas.winfo_height() or CANVAS_H
        scale = max(min(cw / w, ch / h), 0.05)
        resized = cv2.resize(bgr, (int(w * scale), int(h * scale)))
        rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
        self._photo = ImageTk.PhotoImage(Image.fromarray(rgb))
        self.canvas.delete("all")
        self.canvas.create_image(cw // 2, ch // 2, image=self._photo)

    def _finish(self, text: str, error: bool = False) -> None:
        self.start_btn.config(state="normal")
        self.stop_btn.config(state="disabled")
        self.status.config(text=text, foreground="#c00" if error else "#2a7")

    # ---------------- export ---------------- #
    def export(self) -> None:
        if self.engine is None or not self.processed:
            messagebox.showinfo("提示", "先跑一段再导出")
            return
        results_dir().mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        tracks = []
        for tid in sorted(self.seen_ids):
            cands = self.engine.track_candidates(tid, k=5)
            if cands:
                tracks.append({"track_id": tid, "candidates": [[n, round(p, 4)] for n, p in cands]})
        payload = {
            "mode": self.mode,
            "source": str(self.video_path) if self.video_path else list(self.region or []),
            "config": {
                "model": "yolo11n.pt",
                "imgsz": self.imgsz_var.get(),
                "conf": self.conf_var.get(),
                "cls_model": self.cls_var.get(),
                "stride": self.stride_var.get(),
            },
            "run": {
                "frames": self.processed,
                "unique_track_ids": len(self.seen_ids),
                "detections": self.engine.detections_total,
                "skipped_small_crops": self.engine.skipped_small,
                "latency_ms": {
                    "p50": float(np.percentile(self.latencies, 50)) if self.latencies else None,
                    "p95": float(np.percentile(self.latencies, 95)) if self.latencies else None,
                },
            },
            "tracks": tracks,
        }
        out = results_dir() / f"{stamp}_{self.mode}.json"
        out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        messagebox.showinfo("已导出", str(out))


class AudioPanel(ttk.Frame):
    def __init__(self, master, app: "BirdLabApp"):
        super().__init__(master, padding=8)
        self.app = app
        self.engine: AudioEngine | None = None
        self.thread: threading.Thread | None = None
        self.files: list[Path] = []
        self.last_rows: list[dict] = []
        self._build()

    def _build(self) -> None:
        bar = ttk.Frame(self)
        bar.pack(fill="x", pady=(0, 6))
        ttk.Button(bar, text="选择音频…", command=self.pick).pack(side="left")
        self.source_label = ttk.Label(bar, text="未选择文件", foreground="#555")
        self.source_label.pack(side="left", padx=8)

        ttk.Label(bar, text="窗长(s)").pack(side="left", padx=(16, 2))
        self.window_var = tk.StringVar(value="3.0")
        ttk.Combobox(bar, textvariable=self.window_var, values=["1.0", "2.0", "3.0"], width=5, state="readonly").pack(side="left")
        ttk.Label(bar, text="步进(s)").pack(side="left", padx=(10, 2))
        self.hop_var = tk.StringVar(value="1.5")
        ttk.Combobox(bar, textvariable=self.hop_var, values=["0.5", "1.0", "1.5"], width=5, state="readonly").pack(side="left")
        ttk.Label(bar, text="top-k").pack(side="left", padx=(10, 2))
        self.topk_var = tk.StringVar(value="5")
        ttk.Spinbox(bar, textvariable=self.topk_var, from_=1, to=10, width=4).pack(side="left")

        self.run_btn = ttk.Button(bar, text="开始识别", command=self.start)
        self.run_btn.pack(side="right")
        ttk.Button(bar, text="导出结果", command=self.export).pack(side="right", padx=6)

        cols = ("file", "dur", "win", "top1", "p", "p50", "p95")
        self.tree = ttk.Treeview(self, columns=cols, show="headings", height=10)
        for c, txt, w in zip(cols, ["文件", "时长(s)", "窗数", "top-1", "置信度", "p50(ms)", "p95(ms)"], [220, 70, 60, 250, 70, 70, 70]):
            self.tree.heading(c, text=txt)
            self.tree.column(c, width=w, anchor="w")
        self.tree.pack(fill="both", expand=True)
        self.tree.bind("<<TreeviewSelect>>", self._on_select)

        ttk.Label(self, text="选中行的 top-5（跨窗最大值聚合）", foreground="#666").pack(anchor="w", pady=(6, 2))
        self.detail = tk.Text(self, height=8, font=("Consolas", 9))
        self.detail.pack(fill="x")
        self.status = ttk.Label(self, text="就绪", foreground="#2a7")
        self.status.pack(anchor="w", pady=(6, 0))

    def pick(self) -> None:
        patterns = " ".join(f"*{e}" for e in AUDIO_EXTS)
        paths = filedialog.askopenfilenames(title="选择音频（可多选）", filetypes=[("音频文件", patterns), ("所有文件", "*.*")])
        if paths:
            self.files = [Path(p) for p in paths]
            self.source_label.config(text=f"{len(self.files)} 个文件", foreground="#000")

    def start(self) -> None:
        if self.thread and self.thread.is_alive():
            return
        if not self.files:
            messagebox.showinfo("提示", "先选择音频文件")
            return
        self.run_btn.config(state="disabled")
        self.status.config(text="加载 BirdNET…", foreground="#c60")
        self.thread = threading.Thread(target=self._worker, daemon=True)
        self.thread.start()

    def _worker(self) -> None:
        try:
            if self.engine is None:
                self.engine = AudioEngine()
            cfg = (float(self.window_var.get()), float(self.hop_var.get()), int(self.topk_var.get()))
            rows = []
            for path in self.files:
                self.after(0, lambda n=path.name: self.status.config(text=f"识别中：{n}", foreground="#c60"))
                out = self.engine.analyze(path, window=cfg[0], hop=cfg[1], topk=cfg[2])
                rows.append(out)
                self.after(0, lambda r=out: self._add_row(r))
            self.last_rows = rows
            self.after(0, lambda: self.status.config(text=f"完成 {len(rows)} 个文件", foreground="#2a7"))
        except Exception as exc:  # noqa: BLE001
            msg = f"出错：{exc}"
            self.after(0, lambda: self.status.config(text=msg, foreground="#c00"))
        finally:
            self.after(0, lambda: self.run_btn.config(state="normal"))

    def _add_row(self, out: dict) -> None:
        top = out["aggregate"][0]
        self.tree.insert("", "end", iid=out["file"], values=(
            out["file"], out["audio_s"], out["windows"], top[0], f"{top[1]:.3f}",
            out["latency_p50"], out["latency_p95"],
        ))
        if not self.detail.get("1.0", "end").strip():
            self._render_detail(out)

    def _on_select(self, _event=None) -> None:
        sel = self.tree.selection()
        if not sel:
            return
        for row in self.last_rows:
            if row["file"] == sel[0]:
                self._render_detail(row)
                break

    def _render_detail(self, out: dict) -> None:
        lines = [f"{out['file']}  {out['audio_s']}s  {out['windows']} 窗",
                 f"窗长 {out['window_s']}s / 步进 {out['hop_s']}s   解码 {out['load_ms']}ms", ""]
        lines.append("跨窗聚合 top-k：")
        for i, (name, p) in enumerate(out["aggregate"], 1):
            lines.append(f"  {i}. {name:<40} {p:.4f}")
        lines.append("")
        lines.append("逐窗：")
        for w in out["per_window"]:
            top = w["topk"][0]
            lines.append(f"  {w['start_s']:>5.1f}-{w['end_s']:<5.1f}s  {top[0]:<38} {top[1]:.3f}  ({w['latency_ms']}ms)")
        self.detail.delete("1.0", "end")
        self.detail.insert("1.0", "\n".join(lines))

    def export(self) -> None:
        if not self.last_rows:
            messagebox.showinfo("提示", "先跑一次再导出")
            return
        results_dir().mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        out = results_dir() / f"{stamp}_audio.json"
        out.write_text(json.dumps({"runs": self.last_rows}, ensure_ascii=False, indent=2), encoding="utf-8")
        messagebox.showinfo("已导出", str(out))


CHECK_ITEMS = [
    ("启动", "双击 run_gui.bat 能打开窗口，无控制台报错"),
    ("视频导入", "选择 mp4 / mkv / webm 至少 3 种格式，均能开始播放并出框"),
    ("视频识别", "画面出现检测框，框上带 #trackID"),
    ("视频候选", "右侧候选栏出现物种与置信度（若框 <64px 会显示「无候选」）"),
    ("视频延迟", "端到端 p50 ≤ 60 ms（imgsz=640 + ResNet50）"),
    ("屏幕框选", "点击「框选屏幕区域…」能拖出选区，并显示 (x,y) 宽×高"),
    ("屏幕识别", "选区画面实时出框，状态栏 FPS ≥ 5"),
    ("屏幕复位", "停止后重新框选另一块区域，仍能正常识别"),
    ("音频导入", "选择 wav / mp3 / ogg 至少 3 种格式，均能出结果"),
    ("音频候选", "表格出现 top-1 与置信度，详情区有 top-5 与逐窗结果"),
    ("音频延迟", "单窗 p50 ≤ 100 ms"),
    ("导出", "「导出结果 JSON」生成文件，含 config / run / tracks"),
    ("稳定性", "反复开始/停止、切换标签页 5 次，无卡死、无残留线程"),
]


class ChecklistPanel(ttk.Frame):
    def __init__(self, master):
        super().__init__(master, padding=8)
        self.vars: list[tuple[str, tk.BooleanVar]] = []
        ttk.Label(self, text="验收清单（勾选状态可导出为 markdown）", font=("Microsoft YaHei UI", 10, "bold")).pack(anchor="w")
        canvas = tk.Canvas(self, highlightthickness=0)
        scroll = ttk.Scrollbar(self, orient="vertical", command=canvas.yview)
        inner = ttk.Frame(canvas)
        inner.bind("<Configure>", lambda e: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas.create_window((0, 0), window=inner, anchor="nw")
        canvas.configure(yscrollcommand=scroll.set)
        canvas.pack(side="left", fill="both", expand=True)
        scroll.pack(side="right", fill="y")

        for i, (tag, text) in enumerate(CHECK_ITEMS, 1):
            var = tk.BooleanVar(value=False)
            self.vars.append((text, var))
            ttk.Checkbutton(inner, text=f"{i:>2}. [{tag}] {text}", variable=var).pack(anchor="w", pady=1)

        ttk.Button(self, text="导出验收记录", command=self.export).pack(anchor="w", pady=8)

    def export(self) -> None:
        import platform

        import torch

        results_dir().mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        done = sum(1 for _, v in self.vars if v.get())
        lines = [
            f"# GUI 验收记录 {stamp}",
            "",
            f"- 环境：{platform.platform()} / Python {platform.python_version()} / torch {torch.__version__}",
            f"- 完成：{done}/{len(self.vars)}",
            "",
        ]
        for i, (text, var) in enumerate(self.vars, 1):
            lines.append(f"- [{'x' if var.get() else ' '}] {i}. {text}")
        out = results_dir() / f"{stamp}_checklist.md"
        out.write_text("\n".join(lines) + "\n", encoding="utf-8")
        messagebox.showinfo("已导出", f"{out}\n\n完成 {done}/{len(self.vars)}")


class BirdLabApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("观鸟助手 · 技术预研测试台（CPU）")
        self.geometry("1280x840")
        self.minsize(1120, 700)

        style = ttk.Style(self)
        try:
            style.theme_use("vista")
        except Exception:
            pass

        nb = ttk.Notebook(self)
        nb.pack(fill="both", expand=True, padx=6, pady=6)
        self.nb = nb
        self.video_panel = VisionPanel(nb, self, "video")
        self.screen_panel = VisionPanel(nb, self, "screen")
        self.audio_panel = AudioPanel(nb, self)
        self.checklist = ChecklistPanel(nb)
        nb.add(self.video_panel, text="视频文件")
        nb.add(self.screen_panel, text="屏幕区域")
        nb.add(self.audio_panel, text="音频")
        nb.add(self.checklist, text="验收清单")
        self.protocol("WM_DELETE_WINDOW", self._on_close)

    def stop_all(self, except_panel=None) -> None:
        for panel in (self.video_panel, self.screen_panel):
            if panel is not except_panel:
                panel.stop()

    def _on_close(self) -> None:
        self.stop_all()
        self.destroy()


def select_region(root: tk.Misc) -> tuple[int, int, int, int] | None:
    """Full-screen overlay, drag a rectangle, return (left, top, width, height)."""
    overlay = tk.Toplevel(root)
    overlay.attributes("-fullscreen", True)
    overlay.attributes("-alpha", 0.30)
    overlay.attributes("-topmost", True)
    overlay.configure(bg="black")
    overlay.title("框选识别区域（Esc 取消）")
    canvas = tk.Canvas(overlay, bg="black", highlightthickness=0, cursor="crosshair")
    canvas.pack(fill="both", expand=True)
    state: dict = {"result": None}
    canvas.create_text(
        overlay.winfo_screenwidth() // 2, 40,
        text="按住鼠标拖拽框选识别区域，松开确认，Esc 取消",
        fill="#fff", font=("Microsoft YaHei UI", 14),
    )

    def on_press(e):
        state["x0"], state["y0"] = e.x_root, e.y_root
        state["rect"] = canvas.create_rectangle(e.x, e.y, e.x, e.y, outline="#00e5ff", width=2)

    def on_drag(e):
        if "rect" in state:
            canvas.coords(state["rect"], state["x0"] - overlay.winfo_rootx(), state["y0"] - overlay.winfo_rooty(), e.x, e.y)

    def on_release(e):
        x1, y1 = state.get("x0", e.x_root), state.get("y0", e.y_root)
        left, top = min(x1, e.x_root), min(y1, e.y_root)
        w, h = abs(e.x_root - x1), abs(e.y_root - y1)
        if w > 8 and h > 8:
            state["result"] = (int(left), int(top), int(w), int(h))
        overlay.destroy()

    canvas.bind("<ButtonPress-1>", on_press)
    canvas.bind("<B1-Motion>", on_drag)
    canvas.bind("<ButtonRelease-1>", on_release)
    overlay.bind("<Escape>", lambda e: overlay.destroy())
    overlay.focus_force()
    root.wait_window(overlay)
    return state["result"]


def main() -> int:
    import argparse

    ap = argparse.ArgumentParser(description="观鸟助手测试台")
    ap.add_argument("--selftest-video", default="", help="无人值守跑一段视频后自动退出")
    ap.add_argument("--selftest-audio", default="", help="无人值守跑音频（逗号分隔多个）后自动退出")
    ap.add_argument("--autoplay", default="", help="启动后自动播放该视频（演示用，不自动退出）")
    ap.add_argument("--frames", type=int, default=30)
    ap.add_argument("--cls", default="none")
    ap.add_argument("--tab", default="", choices=["", "video", "screen", "audio", "check"], help="启动时切到某个标签页")
    args = ap.parse_args()

    enable_dpi_awareness()
    setup_env()
    app = BirdLabApp()
    tabs = {"video": 0, "screen": 1, "audio": 2, "check": 3}
    if args.tab:
        app.nb.select(tabs[args.tab])
    if args.autoplay:
        panel = app.video_panel
        panel.video_path = resolve_input(args.autoplay)
        panel.source_label.config(text=panel.video_path.name, foreground="#000")
        panel.cls_var.set(args.cls)
        app.after(400, panel.start)
    if args.selftest_audio:
        ap_files = [resolve_input(p) for p in args.selftest_audio.split(",") if p.strip()]
        panel = app.audio_panel
        app.nb.select(2)
        panel.files = ap_files
        panel.source_label.config(text=f"{len(ap_files)} 个文件", foreground="#000")
        app.after(300, panel.start)

        def watch_audio():
            if panel.last_rows:
                for row in panel.last_rows:
                    top = row["aggregate"][0]
                    log_line(f"selftest-audio: {row['file']} windows={row['windows']} "
                             f"top1={top[0]} p={top[1]:.3f} p50={row['latency_p50']}ms")
                app.after(300, app.destroy)
            else:
                app.after(300, watch_audio)

        app.after(600, watch_audio)
    if args.selftest_video:
        panel = app.video_panel
        panel.video_path = resolve_input(args.selftest_video)
        panel.source_label.config(text=panel.video_path.name, foreground="#000")
        panel.cls_var.set(args.cls)
        panel.start()

        def watchdog():
            alive = panel.thread is not None and panel.thread.is_alive()
            if panel.processed >= args.frames or not alive:
                panel.stop()
                lat = list(panel.latencies)
                p50 = float(np.percentile(lat, 50)) if lat else float("nan")
                p95 = float(np.percentile(lat, 95)) if lat else float("nan")
                log_line(f"selftest: frames={panel.processed} ids={len(panel.seen_ids)} "
                         f"p50={p50:.1f}ms p95={p95:.1f}ms cls={args.cls}")
                app.after(300, app.destroy)
            else:
                app.after(200, watchdog)

        app.after(500, watchdog)
    app.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
