"""Shared audio helpers: windowing, SNR mixing, hit scoring."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import soundfile as sf

from birdnet_runtime import SAMPLE_RATE, split_label

MODEL_WINDOW_S = 3.0  # BirdNET v2.4 accepts exactly 144000 samples; no dynamic reshape.


def load_wav(path: str | Path) -> np.ndarray:
    x, sr = sf.read(str(path), dtype="float32", always_2d=True)
    x = x.mean(axis=1) if x.ndim > 1 else x
    if sr != SAMPLE_RATE:
        raise ValueError(f"{path}: expected {SAMPLE_RATE} Hz, got {sr} (run prepare_audio.py)")
    return x.astype(np.float32)


def iter_windows(x: np.ndarray, window_s: float, hop_s: float, pad: bool = True):
    n = int(round(window_s * SAMPLE_RATE))
    hop = max(1, int(round(hop_s * SAMPLE_RATE)))
    out = []
    start = 0
    while start < len(x):
        chunk = x[start : start + n]
        if len(chunk) < n:
            if not pad:
                break
            chunk = np.pad(chunk, (0, n - len(chunk)))
        out.append((start / SAMPLE_RATE, (start + n) / SAMPLE_RATE, chunk))
        if start + n >= len(x):
            break
        start += hop
    return out


def analyze(net, x: np.ndarray, window_s: float, hop_s: float, topk: int = 5, sensitivity: float = 1.0) -> dict:
    """`window_s` is how much real audio we give the model; the model input itself
    must be exactly 3 s (144000 samples), so shorter buffers are zero-padded.
    That mirrors a real app that has only recorded 1 s and pads the rest."""
    model_len = int(round(MODEL_WINDOW_S * SAMPLE_RATE))
    windows = []
    best: dict[str, float] = {}
    for start, end, chunk in iter_windows(x, window_s, hop_s):
        if len(chunk) < model_len:
            chunk = np.pad(chunk, (0, model_len - len(chunk)))
        else:
            chunk = chunk[:model_len]
        probs, ms = net.timed_predict(chunk)
        idx = np.argpartition(-probs, min(topk, len(probs) - 1))[:topk]
        idx = idx[np.argsort(-probs[idx])]
        top = [(net.labels[i], float(probs[i])) for i in idx]
        for label, p in zip(net.labels, probs):
            if p > best.get(label, 0.0):
                best[label] = float(p)
        windows.append({"start_s": round(start, 2), "end_s": round(end, 2), "latency_ms": round(ms, 2), "topk": top})
    agg = sorted(best.items(), key=lambda kv: -kv[1])[:topk]
    return {"windows": windows, "aggregate": agg}


def hit_rank(aggregate: list[tuple[str, float]], expected_sci: str) -> int | None:
    """1-based rank of the expected species in the aggregate list, None if absent."""
    if not expected_sci:
        return None
    want = expected_sci.strip().lower()
    for i, (label, _) in enumerate(aggregate, start=1):
        sci, _common = split_label(label)
        if sci.lower() == want:
            return i
    return None


def mix_at_snr(signal: np.ndarray, noise: np.ndarray, snr_db: float) -> np.ndarray:
    n = len(signal)
    if len(noise) < n:
        reps = int(np.ceil(n / len(noise)))
        noise = np.tile(noise, reps)
    noise = noise[:n]
    p_sig = float(np.mean(signal**2)) or 1e-12
    p_noise = float(np.mean(noise**2)) or 1e-12
    target_noise = p_sig / (10 ** (snr_db / 10.0))
    scaled = noise * np.sqrt(target_noise / p_noise)
    mixed = signal + scaled
    peak = float(np.max(np.abs(mixed)))
    if peak > 0.99:
        mixed = mixed / peak * 0.99
    return mixed.astype(np.float32)
