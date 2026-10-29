#!/usr/bin/env python3
"""Run the real audio model over the sample manifest and write a report.

This is a *behaviour check* of the shipped service (upload validation, ffmpeg
decode, 48 kHz conversion, windowing, aggregation, catalog mapping), not an
accuracy benchmark: the clip set is tiny and mostly clean studio material. The
report says so explicitly and includes every per-clip prediction so a reviewer
can see exactly what happened.

Usage:
    python scripts/evaluate_audio.py
    python scripts/evaluate_audio.py --manifest <path> --output <dir>
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import statistics
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from bird_audio.analyzer import Policy, decide
from bird_audio.audio import AudioDecoder
from bird_audio.config import AudioSettings
from bird_audio.engine import build_engine
from bird_audio.labels import CatalogIndex, link_labels, load_model_labels
from bird_audio.metrics import AudioMetrics
from bird_audio.service import AudioAnalysisService
from bird_audio.windows import required_confirmations
from bird_common.catalog import load_catalog, sha256_file

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = ROOT / "results" / "audio-samples" / "manifest.json"
DEFAULT_OUTPUT = ROOT / "results" / "audio-eval"
SWEEP_SCORES = (0.25, 0.5, 0.7)
SWEEP_CONFIRMATIONS = (1, 2, 3)


class BytesUpload:
    """Minimal UploadFile stand-in so the service code path stays identical."""

    def __init__(self, data: bytes, filename: str, content_type: str) -> None:
        self._data = data
        self.filename = filename
        self.content_type = content_type

    async def read(self, size: int = -1) -> bytes:
        if size is None or size < 0:
            chunk, self._data = self._data, b""
            return chunk
        chunk, self._data = self._data[:size], self._data[size:]
        return chunk


CONTENT_TYPES = {"mp3": "audio/mpeg", "wav": "audio/wav", "aac": "audio/aac", "m4a": "audio/mp4"}


def percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round(fraction * (len(ordered) - 1))))
    return round(ordered[index], 3)


def expected_species_id(index: CatalogIndex | None, scientific_name: str | None) -> str | None:
    if index is None or not scientific_name:
        return None
    taxon = index.by_scientific_name.get(scientific_name.casefold())
    return taxon.species_id if taxon else None


def evaluate_decision(entry: dict[str, Any], report, expected_id: str | None) -> dict[str, Any]:
    candidates = report.candidates
    expected_rank = None
    if expected_id is not None:
        for rank, candidate in enumerate(candidates, start=1):
            if candidate.species_id == expected_id:
                expected_rank = rank
                break
    elif entry.get("expected_scientific"):
        wanted = str(entry["expected_scientific"]).casefold()
        for rank, candidate in enumerate(candidates, start=1):
            if candidate.scientific_name.casefold() == wanted:
                expected_rank = rank
                break
    top = candidates[0] if candidates else None
    return {
        "sample_id": entry["sample_id"],
        "file": entry["file"],
        "kind": entry["kind"],
        "container": entry["container"],
        "short": entry.get("short", False),
        "recorded_like": entry.get("recorded_like"),
        "expected_scientific": entry.get("expected_scientific"),
        "expected_species_id": expected_id,
        "state": report.state,
        "reason": report.decision.reason,
        "top1_species_id": top.species_id if top else None,
        "top1_scientific_name": top.scientific_name if top else None,
        "top1_mapped": top.mapped if top else None,
        "top1_score": round(top.score, 6) if top else None,
        "expected_rank": expected_rank,
        "correct_top1": expected_rank == 1,
        "expected_found": expected_rank is not None,
        "false_positive": entry["kind"] == "negative" and report.state == "candidate",
        "duration_seconds": round(report.audio.duration_seconds, 3),
        "window_count": len(report.windows),
        "timing": report.timings,
        "notes": list(report.notes),
        "top_labels": [
            {"model_label": label["model_label"], "score": label["score"]}
            for label in report.decision.top_labels[:3]
        ],
    }


def sweep(reports: list[tuple[dict[str, Any], Any, str | None]], labels, links) -> list[dict[str, Any]]:
    rows = []
    for min_score in SWEEP_SCORES:
        for minimum in SWEEP_CONFIRMATIONS:
            correct = 0
            birds = 0
            false_positives = 0
            negatives = 0
            unknown = 0
            for entry, report, expected_id in reports:
                policy = Policy(
                    min_score=min_score,
                    min_confirming_windows=minimum,
                    min_margin=0.0,
                    candidate_count=5,
                    required_windows=required_confirmations(len(report.windows), minimum),
                )
                decision = decide(report.windows, labels, links, policy)
                if entry["kind"] == "bird":
                    birds += 1
                    if decision.state == "candidate":
                        top = decision.candidates[0]
                        expected_name = str(entry.get("expected_scientific") or "").casefold()
                        matched = (
                            top.species_id == expected_id
                            if expected_id is not None
                            else top.scientific_name.casefold() == expected_name
                        )
                        if matched:
                            correct += 1
                else:
                    negatives += 1
                    if decision.state == "candidate":
                        false_positives += 1
                if decision.state == "unknown":
                    unknown += 1
            rows.append(
                {
                    "min_score": min_score,
                    "min_confirming_windows": minimum,
                    "bird_top1": correct,
                    "bird_samples": birds,
                    "negative_false_positives": false_positives,
                    "negative_samples": negatives,
                    "unknown_results": unknown,
                }
            )
    return rows


def build_markdown(payload: dict[str, Any]) -> str:
    summary = payload["summary"]
    lines = [
        "# 音频服务样本验证（真实模型）",
        "",
        f"- 生成时间：{payload['generated_at']}",
        f"- 引擎：{payload['engine']['backend']}（{payload['engine']['name']}）",
        f"- 模型 SHA-256：`{payload['engine']['model_sha256']}`",
        f"- 标签 SHA-256：`{payload['engine']['labels_sha256']}`",
        f"- 阈值策略：min_score={payload['policy']['min_score']}，"
        f"最少跨窗确认={payload['policy']['min_confirming_windows']}，"
        f"窗口={payload['policy']['window_seconds']}s / 步进={payload['policy']['hop_seconds']}s",
        "",
        "> 样本量很小，且以预研素材为主（补充的“手机格式”是同一素材的转码，不是真机录音）。"
        "下表用于验证流程与错误处理，不能作为整体准确率结论。",
        "",
        "## 1. 汇总",
        "",
        "| 指标 | 值 |",
        "|---|---:|",
        f"| 鸟声样本数 | {summary['bird_samples']} |",
        f"| top-1 命中 | {summary['bird_top1']} / {summary['bird_samples']} |",
        f"| 期望物种出现在候选中 | {summary['bird_found']} / {summary['bird_samples']} |",
        f"| 负样本数 | {summary['negative_samples']} |",
        f"| 负样本误报（state=candidate） | {summary['negative_false_positives']} / "
        f"{summary['negative_samples']} |",
        f"| 返回 unknown 的比例 | {summary['unknown_ratio']:.0%} |",
        f"| 端到端耗时 p50 / p95 | {summary['total_ms_p50']} / {summary['total_ms_p95']} ms |",
        f"| 解码耗时 p50 / p95 | {summary['decode_ms_p50']} / {summary['decode_ms_p95']} ms |",
        f"| 单窗推理 p50 / p95 | {summary['inference_ms_p50']} / {summary['inference_ms_p95']} ms |",
        "",
        "## 2. 逐样本结果",
        "",
        "| 样本 | 格式 | 期望 | 状态 | top-1 | 分数 | rank | 耗时 ms |",
        "|---|---|---|---|---|---:|---:|---:|",
    ]
    for row in payload["samples"]:
        cells = (
            row["sample_id"],
            f"{row['container']}{' (2 s)' if row['short'] else ''}",
            row["expected_scientific"] or "（无鸟）",
            row["state"],
            row["top1_scientific_name"] or "—",
            f"{row['top1_score']:.3f}" if row["top1_score"] is not None else "—",
            row["expected_rank"] if row["expected_rank"] is not None else "—",
            int(row["timing"]["total_ms"]),
        )
        lines.append("| " + " | ".join(str(cell) for cell in cells) + " |")
    lines += [
        "",
        "## 3. 阈值/跨窗策略扫描",
        "",
        "| min_score | 最少确认窗 | 鸟声 top-1 | 负样本误报 | unknown |",
        "|---:|---:|---:|---:|---:|",
    ]
    for row in payload["sweep"]:
        lines.append(
            f"| {row['min_score']} | {row['min_confirming_windows']} | "
            f"{row['bird_top1']}/{row['bird_samples']} | "
            f"{row['negative_false_positives']}/{row['negative_samples']} | {row['unknown_results']} |"
        )
    lines += [
        "",
        "## 4. 说明与限制",
        "",
        "- `state=candidate` 只表示“达到当前阈值且满足跨窗确认”，不是识别正确率。",
        "- 扫描表用同一批窗口分数离线重算，因此可与上表的逐样本结果对照。",
        "- 真机录音（不同麦克风、风噪、远距离）仍需前端按 `docs/音频识别后端/API.md` 的"
        "`wx.uploadFile` 示例补测；本仓库不包含真机音频。",
        "",
    ]
    return "\n".join(lines)


async def run(args: argparse.Namespace) -> int:
    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    settings = AudioSettings()
    if settings.engine_backend != "birdnet" and not args.allow_mock:
        print(
            "BIRD_AUDIO_ENGINE_BACKEND is not birdnet; set it to birdnet (or pass --allow-mock).",
            file=sys.stderr,
        )
        return 2
    labels = load_model_labels(settings.labels_path.expanduser())
    index = None
    links = link_labels(labels, None)
    catalog_info: dict[str, Any] = {"available": False}
    if settings.catalog_path is not None and settings.catalog_path.expanduser().is_file():
        taxa = load_catalog(settings.catalog_path)
        index = CatalogIndex.build(taxa)
        links = link_labels(labels, index)
        catalog_info = {
            "available": True,
            "path": str(settings.catalog_path),
            "version": taxa[0].taxon_version,
            "checksum_sha256": sha256_file(settings.catalog_path),
            "total_species": len(taxa),
        }
    engine = build_engine(settings, labels)
    engine.load()
    decoder = AudioDecoder(settings)
    service = AudioAnalysisService(settings, engine, labels, links, AudioMetrics(), decoder=decoder)

    results: list[dict[str, Any]] = []
    collect: list[tuple[dict[str, Any], Any, str | None]] = []
    failures: list[dict[str, Any]] = []
    try:
        for entry in manifest["samples"]:
            path = Path(args.manifest).parent / entry["file"]
            data = path.read_bytes()
            content_type = CONTENT_TYPES[entry["container"]]
            upload = BytesUpload(data, entry["file"], content_type)
            service.admit()
            try:
                report = await service.analyze(upload, top_k=5)
            except Exception as exc:  # noqa: BLE001 - recorded as evidence
                failures.append({"sample_id": entry["sample_id"], "error": f"{type(exc).__name__}: {exc}"})
                continue
            finally:
                service.release()
            expected_id = expected_species_id(index, entry.get("expected_scientific"))
            row = evaluate_decision(entry, report, expected_id)
            results.append(row)
            collect.append((entry, report, expected_id))
    finally:
        engine.close()

    birds = [row for row in results if row["kind"] == "bird"]
    negatives = [row for row in results if row["kind"] == "negative"]
    totals = [row["timing"]["total_ms"] for row in results]
    decodes = [row["timing"]["decode_ms"] for row in results]
    inferences = [window.inference_ms for entry, report, _ in collect for window in report.windows]
    summary = {
        "bird_samples": len(birds),
        "bird_top1": sum(1 for row in birds if row["correct_top1"]),
        "bird_found": sum(1 for row in birds if row["expected_found"]),
        "negative_samples": len(negatives),
        "negative_false_positives": sum(1 for row in negatives if row["false_positive"]),
        "unknown_ratio": (
            sum(1 for row in results if row["state"] == "unknown") / len(results) if results else 0.0
        ),
        "total_ms_p50": percentile(totals, 0.5),
        "total_ms_p95": percentile(totals, 0.95),
        "decode_ms_p50": percentile(decodes, 0.5),
        "decode_ms_p95": percentile(decodes, 0.95),
        "inference_ms_p50": percentile(inferences, 0.5),
        "inference_ms_p95": percentile(inferences, 0.95),
        "mean_total_ms": round(statistics.fmean(totals), 3) if totals else None,
    }
    payload: dict[str, Any] = {
        "generated_at": datetime.now(UTC).isoformat(),
        "manifest": str(Path(args.manifest).resolve()),
        "note": manifest.get("note"),
        "engine": {
            "name": engine.name,
            "backend": engine.backend,
            "model_sha256": settings.model_sha256 or sha256_file(settings.model_path.expanduser()),
            "labels_sha256": settings.labels_sha256 or sha256_file(settings.labels_path.expanduser()),
            "labels": len(labels),
        },
        "catalog": catalog_info,
        "policy": {
            "min_score": settings.min_score,
            "min_confirming_windows": settings.min_confirming_windows,
            "window_seconds": settings.window_seconds,
            "hop_seconds": settings.hop_seconds,
            "candidate_count": settings.candidate_count,
        },
        "summary": summary,
        "samples": results,
        "failures": failures,
        "sweep": sweep(collect, labels, links),
    }
    (output / "audio-eval.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    markdown = build_markdown(payload)
    (output / "audio-eval.md").write_text(markdown, encoding="utf-8")
    print(markdown)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--manifest", default=str(DEFAULT_MANIFEST))
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--allow-mock", action="store_true", help="allow the deterministic mock engine")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="bird-audio-eval-") as temp:
        os.environ.setdefault("BIRD_AUDIO_TEMP_DIR", temp)
        return asyncio.run(run(args))


if __name__ == "__main__":
    raise SystemExit(main())
