#!/usr/bin/env python3
"""End-to-end HTTP smoke test and integration evidence for the audio API.

Every sample from ``prepare_audio_samples.py`` is uploaded as real multipart
media, so the evidence covers exactly what the mini program does: a compressed
file over HTTP, not a hand-made WAV handed to the model.

Error cases (empty, corrupt, unsupported, mismatched, too short, too long and
oversized uploads) are exercised on the same endpoint and must produce the
documented stable codes.

Usage:
    python scripts/smoke_audio_service.py --base-url http://127.0.0.1:8100
    python scripts/smoke_audio_service.py            # in-process ASGI transport
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import time
from contextlib import nullcontext
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = ROOT / "results" / "audio-samples" / "manifest.json"
DEFAULT_OUTPUT = ROOT / "results" / "audio-smoke"
ANALYSES_PATH = "/api/v1/audio/analyses"
CONTENT_TYPES = {"mp3": "audio/mpeg", "wav": "audio/wav", "aac": "audio/aac", "m4a": "audio/mp4"}


def find_ffmpeg() -> str:
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError as exc:
        found = shutil.which("ffmpeg")
        if not found:
            raise SystemExit("ffmpeg is required to build the error-case fixtures") from exc
        return found


def make_fixtures(directory: Path, source_mp3: Path) -> list[dict[str, Any]]:
    """Build the deterministic failure fixtures used for the error-code checks."""
    ffmpeg = find_ffmpeg()
    fixtures: list[dict[str, Any]] = []

    empty = directory / "empty.mp3"
    empty.write_bytes(b"")
    fixtures.append(
        {"name": "empty", "path": empty, "content_type": "audio/mpeg", "expect": "EMPTY_AUDIO", "status": 422}
    )

    # Recognisable MP3 framing with a broken payload: the file *is* the declared
    # type, so the service must report a decode failure, not an unknown format.
    corrupt = directory / "corrupt.mp3"
    corrupt.write_bytes(b"ID3\x04\x00\x00\x00\x00\x00\x00" + b"\xff\xfb\x90\x00" + bytes(range(256)) * 16)
    fixtures.append(
        {
            "name": "corrupt",
            "path": corrupt,
            "content_type": "audio/mpeg",
            "expect": "AUDIO_DECODE_FAILED",
            "status": 422,
        }
    )

    # Bytes with no recognisable audio framing at all.
    unidentifiable = directory / "unidentifiable.mp3"
    unidentifiable.write_bytes(b"ID3\x04\x00\x00\x00\x00\x00\x00" + b"\x00\xff" * 4096)
    fixtures.append(
        {
            "name": "unidentifiable",
            "path": unidentifiable,
            "content_type": "audio/mpeg",
            "expect": "UNSUPPORTED_AUDIO_FORMAT",
            "status": 415,
        }
    )

    unsupported = directory / "notes.txt"
    unsupported.write_text("this is not audio\n", encoding="utf-8")
    fixtures.append(
        {
            "name": "unsupported",
            "path": unsupported,
            "content_type": "application/octet-stream",
            "expect": "UNSUPPORTED_AUDIO_FORMAT",
            "status": 415,
        }
    )

    mismatch = directory / "mismatch.wav"
    mismatch.write_bytes(source_mp3.read_bytes())
    fixtures.append(
        {
            "name": "mismatch",
            "path": mismatch,
            "content_type": "audio/wav",
            "expect": "AUDIO_FORMAT_MISMATCH",
            "status": 415,
        }
    )

    too_short = directory / "too-short.mp3"
    subprocess.run(
        [
            ffmpeg,
            "-hide_banner",
            "-nostdin",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=900:duration=0.3",
            "-ar",
            "44100",
            "-ac",
            "1",
            "-c:a",
            "libmp3lame",
            str(too_short),
        ],
        check=True,
    )
    fixtures.append(
        {
            "name": "too_short",
            "path": too_short,
            "content_type": "audio/mpeg",
            "expect": "AUDIO_TOO_SHORT",
            "status": 422,
        }
    )

    too_long = directory / "too-long.mp3"
    subprocess.run(
        [
            ffmpeg,
            "-hide_banner",
            "-nostdin",
            "-loglevel",
            "error",
            "-y",
            "-stream_loop",
            "12",
            "-i",
            str(source_mp3),
            "-t",
            "90",
            "-ar",
            "44100",
            "-ac",
            "1",
            "-c:a",
            "libmp3lame",
            str(too_long),
        ],
        check=True,
    )
    fixtures.append(
        {
            "name": "too_long",
            "path": too_long,
            "content_type": "audio/mpeg",
            "expect": "AUDIO_TOO_LONG",
            "status": 413,
        }
    )

    oversized = directory / "oversized.mp3"
    with oversized.open("wb") as handle:
        handle.write(b"ID3\x04\x00\x00\x00\x00\x00\x00")
        remaining = 11 * 1024 * 1024
        chunk = b"\x00" * (1024 * 1024)
        while remaining > 0:
            handle.write(chunk[: min(remaining, len(chunk))])
            remaining -= len(chunk)
    fixtures.append(
        {
            "name": "oversized",
            "path": oversized,
            "content_type": "audio/mpeg",
            "expect": "AUDIO_TOO_LARGE",
            "status": 413,
        }
    )
    return fixtures


async def post(client: httpx.AsyncClient, path: Path, content_type: str, extra: dict[str, str] | None = None):
    started = time.perf_counter()
    with path.open("rb") as handle:
        response = await client.post(
            ANALYSES_PATH,
            files={"audio": (path.name, handle, content_type)},
            data=extra or {},
        )
    elapsed = (time.perf_counter() - started) * 1000.0
    return response, elapsed


def summarize(response: httpx.Response) -> dict[str, Any]:
    try:
        body = response.json()
    except ValueError:  # pragma: no cover - the service always returns JSON
        return {"raw": response.text[:400]}
    if "error" in body:
        return {"error": body["error"]}
    return {
        "analysis_id": body.get("analysis_id"),
        "state": body.get("state"),
        "reason": body.get("policy", {}).get("reason"),
        "candidates": [
            {
                "rank": candidate["rank"],
                "species_id": candidate["species_id"],
                "scientific_name": candidate["scientific_name"],
                "common_name_zh": candidate["common_name_zh"],
                "score": candidate["score"],
                "score_type": candidate["score_type"],
                "mapped": candidate["mapped"],
            }
            for candidate in body.get("candidates", [])[:3]
        ],
        "audio": body.get("audio"),
        "policy": body.get("policy"),
        "timing": body.get("timing"),
        "model": {
            "name": body.get("model", {}).get("name"),
            "backend": body.get("model", {}).get("backend"),
            "details": body.get("model", {}).get("details"),
        },
        "notes": body.get("notes"),
    }


async def run(args: argparse.Namespace) -> int:
    manifest_path = Path(args.manifest)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    fixtures_dir = output / "fixtures"
    fixtures_dir.mkdir(exist_ok=True)
    source_mp3 = manifest_path.parent / manifest["samples"][0]["file"]
    fixtures = make_fixtures(fixtures_dir, source_mp3)

    requests: list[dict[str, Any]] = []
    if args.base_url:
        lifespan = nullcontext()
        client_context = httpx.AsyncClient(base_url=args.base_url, timeout=120.0)
        entry_point = args.base_url
    else:
        from bird_audio.app import create_app

        app = create_app()
        lifespan = app.router.lifespan_context(app)
        client_context = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://in-process", timeout=120.0
        )
        entry_point = "in-process ASGI"

    async with lifespan, client_context as client:
        health = await client.get("/readyz")
        for entry in manifest["samples"]:
            path = manifest_path.parent / entry["file"]
            response, elapsed = await post(
                client,
                path,
                CONTENT_TYPES[entry["container"]],
                {"top_k": "3", "client_reference": entry["sample_id"]},
            )
            requests.append(
                {
                    "kind": "sample",
                    "sample_id": entry["sample_id"],
                    "file": entry["file"],
                    "content_type": CONTENT_TYPES[entry["container"]],
                    "expected_scientific": entry.get("expected_scientific"),
                    "expected_kind": entry["kind"],
                    "http_status": response.status_code,
                    "elapsed_ms": round(elapsed, 3),
                    "response": summarize(response),
                }
            )
        for fixture in fixtures:
            response, elapsed = await post(client, fixture["path"], fixture["content_type"])
            error_code = response.json().get("error", {}).get("code")
            requests.append(
                {
                    "kind": "error_case",
                    "sample_id": fixture["name"],
                    "file": fixture["path"].name,
                    "content_type": fixture["content_type"],
                    "expected_code": fixture["expect"],
                    "expected_status": fixture["status"],
                    "http_status": response.status_code,
                    "error_code": error_code,
                    "passed": error_code == fixture["expect"] and response.status_code == fixture["status"],
                    "elapsed_ms": round(elapsed, 3),
                    "response": summarize(response),
                }
            )

    samples = [item for item in requests if item["kind"] == "sample"]
    error_cases = [item for item in requests if item["kind"] == "error_case"]
    evidence = {
        "generated_at": datetime.now(UTC).isoformat(),
        "entry_point": entry_point,
        "readyz_status": health.status_code,
        "readyz": health.json() if health.status_code == 200 else None,
        "note": (
            "Multipart uploads of real MP3/AAC/WAV files through the public endpoint. "
            "The clips come from the issue #6 set re-encoded to recorder-like formats; "
            "device-recorded files still need one run from the front end."
        ),
        "summary": {
            "samples": len(samples),
            "samples_ok": sum(1 for item in samples if item["http_status"] == 200),
            "candidate_results": sum(1 for item in samples if item["response"].get("state") == "candidate"),
            "unknown_results": sum(1 for item in samples if item["response"].get("state") == "unknown"),
            "error_cases": len(error_cases),
            "error_cases_passed": sum(1 for item in error_cases if item["passed"]),
            "mean_total_ms": round(
                sum(item["response"].get("timing", {}).get("total_ms", 0.0) for item in samples)
                / max(len(samples), 1),
                3,
            ),
        },
        "requests": requests,
    }
    (output / "integration-evidence.json").write_text(
        json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(evidence["summary"], ensure_ascii=False, indent=2))
    failed = [item["sample_id"] for item in error_cases if not item["passed"]]
    if failed:
        print(f"error cases that did not match: {failed}")
        return 1
    return 0


def main() -> int:
    import asyncio

    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--base-url", default=None, help="running service, e.g. http://127.0.0.1:8100")
    parser.add_argument("--manifest", default=str(DEFAULT_MANIFEST))
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    args = parser.parse_args()
    return asyncio.run(run(args))


if __name__ == "__main__":
    raise SystemExit(main())
