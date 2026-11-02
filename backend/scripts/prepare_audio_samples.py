#!/usr/bin/env python3
"""Turn the issue #6 field clips into mini-program-like recordings.

The audio API accepts MP3/WAV/AAC/M4A uploads, so validating it with the
pre-research WAV files alone would not prove much. This script re-encodes every
clip with the containers, sample rates and channel counts a WeChat recorder can
produce, and writes a manifest the evaluator and smoke test consume.

Source clips are the pre-research set (CC BY / CC BY-NC-SA, see NOTICE.md):
A1-A5 bird songs, N1 speech, N2 city traffic, N3 synthetic wind.

Usage:
    python scripts/prepare_audio_samples.py
    python scripts/prepare_audio_samples.py --source ../鸟类识别预研/data/audio --output results/audio-samples
"""

from __future__ import annotations

import argparse
import csv
import json
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT.parent / "鸟类识别预研" / "data" / "audio"
DEFAULT_OUTPUT = ROOT / "results" / "audio-samples"

# (suffix, ffmpeg args, container, description)
VARIANTS = [
    (
        "mp3_44k_mono",
        ["-ar", "44100", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "96k"],
        "mp3",
        "WeChat mp3 default",
    ),
    (
        "aac_16k_mono",
        ["-ar", "16000", "-ac", "1", "-c:a", "aac", "-b:a", "48k", "-f", "adts"],
        "aac",
        "WeChat aac low rate",
    ),
    ("wav_48k_mono", ["-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le"], "wav", "WeChat wav"),
]
SHORT_VARIANT_SECONDS = 2.0


def find_ffmpeg(explicit: str | None) -> str:
    if explicit:
        return explicit
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        return "ffmpeg"


def locate_source(source_dir: Path, clip_name: str) -> Path | None:
    stem = Path(clip_name).stem
    for suffix in (".ogg", ".mp3", ".wav"):
        candidate = source_dir / f"{stem}{suffix}"
        if candidate.is_file():
            return candidate
    wav_candidate = source_dir / "wav" / f"{stem}.wav"
    return wav_candidate if wav_candidate.is_file() else None


def encode(ffmpeg: str, source: Path, target: Path, args: list[str], duration: float | None = None) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    command = [ffmpeg, "-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i", str(source)]
    if duration is not None:
        command += ["-t", f"{duration:.3f}"]
    command += ["-vn", "-map_metadata", "-1", *args, str(target)]
    completed = subprocess.run(command, capture_output=True, check=False)
    if completed.returncode != 0:
        message = completed.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"ffmpeg failed for {target.name}: {message}")


def read_labels(source_dir: Path) -> list[dict[str, str]]:
    labels_path = source_dir / "labels.csv"
    if not labels_path.is_file():
        raise SystemExit(f"labels.csv not found in {source_dir}; run scripts/fetch_assets.py first")
    with labels_path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--duration",
        type=float,
        default=10.0,
        help="seconds of each source clip to encode (the pre-research excerpt length)",
    )
    parser.add_argument("--ffmpeg", default=None)
    args = parser.parse_args()

    ffmpeg = find_ffmpeg(args.ffmpeg)
    rows = read_labels(args.source)
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    samples: list[dict[str, object]] = []
    missing: list[str] = []

    for row in rows:
        prefix = row["prefix"]
        source = locate_source(args.source, row.get("clip") or prefix)
        if source is None:
            missing.append(prefix)
            continue
        kind = row.get("kind", "bird")
        for suffix, encode_args, container, description in VARIANTS:
            name = f"{prefix}_{suffix}.{container}"
            encode(ffmpeg, source, output / name, encode_args, duration=args.duration)
            samples.append(
                {
                    "sample_id": f"{prefix}_{suffix}",
                    "file": name,
                    "expected_scientific": row.get("scientific_name") or None,
                    "expected_common": row.get("common_name") or None,
                    "kind": kind,
                    "container": container,
                    "recorded_like": description,
                    "clip": prefix,
                    "short": False,
                }
            )
        short_name = f"{prefix}_mp3_44k_mono_short.{'mp3'}"
        encode(
            ffmpeg,
            source,
            output / short_name,
            VARIANTS[0][1],
            duration=min(SHORT_VARIANT_SECONDS, args.duration),
        )
        samples.append(
            {
                "sample_id": f"{prefix}_mp3_44k_mono_short",
                "file": short_name,
                "expected_scientific": row.get("scientific_name") or None,
                "expected_common": row.get("common_name") or None,
                "kind": kind,
                "container": "mp3",
                "recorded_like": f"{SHORT_VARIANT_SECONDS:.0f} s excerpt, WeChat mp3",
                "clip": prefix,
                "short": True,
            }
        )

    manifest = {
        "generated_at": datetime.now(UTC).isoformat(),
        "source_dir": str(args.source.resolve()),
        "ffmpeg": ffmpeg,
        "note": (
            "Containers and sample rates mirror what the WeChat recorder can produce; the audio "
            "itself is the issue #6 clip set. These are NOT device recordings."
        ),
        "samples": samples,
        "missing_clips": missing,
    }
    manifest_path = output / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {len(samples)} samples to {output}")
    print(f"manifest: {manifest_path}")
    if missing:
        print(f"warning: source clips missing: {', '.join(missing)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
