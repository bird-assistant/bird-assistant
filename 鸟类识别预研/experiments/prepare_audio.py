"""Decode the downloaded clips into 48 kHz mono wav and build labels.csv.

Also synthesises a wind-like negative (no real wind recording was used).

    python experiments/prepare_audio.py --src data/audio --out data/audio/wav --trim 10
"""

from __future__ import annotations

import argparse
import csv
import json
import subprocess
import sys
from fractions import Fraction
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

sys.path.insert(0, str(Path(__file__).resolve().parent))
from birdnet_runtime import SAMPLE_RATE  # noqa: E402

# prefix -> (common name, scientific name, source page)
SPECIES = {
    "A1": ("Common Blackbird", "Turdus merula", "commons.wikimedia.org File:Turdus merula - Common Blackbird XC125792.ogg"),
    "A2": ("Great Tit", "Parus major", "commons.wikimedia.org File:Parus major - Great Tit XC129643.ogg"),
    "A3": ("Eurasian Blue Tit", "Cyanistes caeruleus", "commons.wikimedia.org File:Cyanistes caeruleus - Eurasian Blue Tit XC131316.ogg"),
    "A4": ("Common Cuckoo", "Cuculus canorus", "commons.wikimedia.org File:Cuculus canorus - Common Cuckoo XC457076.mp3"),
    "A5": ("Common Chaffinch", "Fringilla coelebs", "commons.wikimedia.org File:Fringilla coelebs - Common Chaffinch XC489277.mp3"),
    "N1": ("(human speech)", "", "commons.wikimedia.org File:Watt Wikipedia article spoken version.ogg"),
    "N2": ("(city traffic)", "", "commons.wikimedia.org File:Sunday in the city street noise1.ogg"),
}


def to_mono(x: np.ndarray) -> np.ndarray:
    return x.mean(axis=1) if x.ndim > 1 else x


def resample(x: np.ndarray, sr_in: int, sr_out: int = SAMPLE_RATE) -> np.ndarray:
    if sr_in == sr_out:
        return x
    frac = Fraction(sr_out, sr_in).limit_denominator(1000)
    return resample_poly(x, frac.numerator, frac.denominator)


def decode_48k_mono(path: Path) -> np.ndarray:
    """ffmpeg handles every container/codec (incl. opus, which libsndfile chokes on)."""
    try:
        import imageio_ffmpeg

        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        raw = subprocess.run(
            [ffmpeg, "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", str(SAMPLE_RATE), "-"],
            capture_output=True,
            check=True,
        ).stdout
        return np.frombuffer(raw, dtype=np.float32).copy()
    except Exception:
        data, sr = sf.read(str(path), dtype="float32", always_2d=True)
        return resample(to_mono(data), sr).astype(np.float32)


def loudest_window(x: np.ndarray, sr: int, seconds: float) -> np.ndarray:
    """Pick the highest-RMS `seconds` slice so call-only clips don't start with silence."""
    n = int(seconds * sr)
    if len(x) <= n:
        return x
    csum = np.concatenate(([0.0], np.cumsum(np.abs(x), dtype=np.float64)))
    energies = csum[n:] - csum[:-n]
    start = int(np.argmax(energies))
    return x[start : start + n]


def pink_noise(n: int, rng: np.random.Generator) -> np.ndarray:
    white = rng.normal(0, 1, n)
    spec = np.fft.rfft(white)
    freqs = np.fft.rfftfreq(n, d=1.0 / SAMPLE_RATE)
    spec[1:] /= np.sqrt(freqs[1:])
    spec[0] = 0
    out = np.fft.irfft(spec, n)
    return out / (np.max(np.abs(out)) + 1e-9)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", default="data/audio")
    ap.add_argument("--out", default="data/audio/wav")
    ap.add_argument("--trim", type=float, default=10.0)
    ap.add_argument("--threads", type=int, default=4)
    args = ap.parse_args(argv)

    src, out = Path(args.src).expanduser().resolve(), Path(args.out).expanduser().resolve()
    out.mkdir(parents=True, exist_ok=True)

    rows = []
    for path in sorted(src.iterdir()):
        if path.suffix.lower() not in {".ogg", ".oga", ".mp3", ".wav", ".flac"} or not path.is_file():
            continue
        prefix = path.stem.split("_")[0]
        common, scientific, source = SPECIES.get(prefix, ("(unknown)", "", ""))
        x = decode_48k_mono(path)
        x = loudest_window(x, SAMPLE_RATE, args.trim)
        peak = float(np.max(np.abs(x))) or 1.0
        x = (x / peak * 0.7).astype(np.float32)
        dst = out / f"{path.stem}.wav"
        sf.write(str(dst), x, SAMPLE_RATE, subtype="PCM_16")
        rows.append(
            {
                "clip": dst.name,
                "prefix": prefix,
                "common_name": common,
                "scientific_name": scientific,
                "duration_s": round(len(x) / SAMPLE_RATE, 2),
                "rms": round(float(np.sqrt(np.mean(x**2))), 5),
                "source": source,
                "kind": "bird" if prefix.startswith("A") else "negative",
            }
        )

    rng = np.random.default_rng(0)
    wind = (pink_noise(int(args.trim * SAMPLE_RATE), rng) * 0.3).astype(np.float32)
    wind_path = out / "N3_wind_synthetic.wav"
    sf.write(str(wind_path), wind, SAMPLE_RATE, subtype="PCM_16")
    rows.append(
        {
            "clip": wind_path.name,
            "prefix": "N3",
            "common_name": "(wind-like pink noise, synthetic)",
            "scientific_name": "",
            "duration_s": round(len(wind) / SAMPLE_RATE, 2),
            "rms": round(float(np.sqrt(np.mean(wind**2))), 5),
            "source": "synthesised (1/f noise)",
            "kind": "negative",
        }
    )

    labels = out.parent / "labels.csv"
    with labels.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    print(json.dumps(rows, indent=2, ensure_ascii=False))
    print(f"\nwrote {len(rows)} wav files to {out}\nwrote {labels}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
