#!/usr/bin/env python3
"""Download a pinned BioCLIP snapshot and print production model fingerprints."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

from bird_vision.inference.species import _directory_fingerprint


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(4 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def prepare(yolo: Path, repository: str, revision: str) -> dict[str, str]:
    from huggingface_hub import HfApi, snapshot_download

    weights = yolo.expanduser().resolve()
    if not weights.is_file():
        raise FileNotFoundError(f"YOLO weights not found: {weights}")
    resolved = HfApi().model_info(repository, revision=revision).sha
    if not resolved or not re.fullmatch(r"[0-9a-fA-F]{40}", resolved):
        raise ValueError("Hugging Face did not return a full immutable commit SHA")
    snapshot = Path(snapshot_download(repo_id=repository, revision=resolved)).resolve()
    if snapshot.name.casefold() != resolved.casefold():
        raise ValueError("downloaded snapshot directory does not match the resolved commit")
    return {
        "BIRD_VISION_MODEL_PATH": str(weights),
        "BIRD_VISION_MODEL_SHA256": sha256(weights),
        "BIRD_VISION_BIOCLIP_MODEL": f"hf-hub:{repository}",
        "BIRD_VISION_BIOCLIP_MODEL_REVISION": resolved,
        "BIRD_VISION_BIOCLIP_EXPECTED_FINGERPRINT": _directory_fingerprint(snapshot),
        "BIOCLIP_LOCAL_SNAPSHOT": str(snapshot),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--yolo", required=True, type=Path, help="local YOLO .pt weights")
    parser.add_argument("--bioclip-repo", default="imageomics/bioclip-2")
    parser.add_argument(
        "--bioclip-revision",
        default="main",
        help="branch/tag/commit to resolve once; output always contains the immutable commit",
    )
    parser.add_argument("--output", type=Path, help="optional JSON report")
    args = parser.parse_args()
    report = prepare(args.yolo, args.bioclip_repo, args.bioclip_revision)
    rendered = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
