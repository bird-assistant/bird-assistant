"""BirdNET label handling and species-catalog alignment.

BirdNET ships one label per line as ``Scientific name_Common name``. Its taxonomy
(eBird/Clements) does not match the project's AviList catalog one-to-one, so a
label is linked by exact scientific name first, then by a *unique* English common
name. Anything else keeps its raw BirdNET identity and is reported as unmapped
instead of being guessed.
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from bird_common.catalog import Taxon

# BirdNET v2.4 raises eight non-bird classes alongside the 6514 bird species.
NON_BIRD_LABELS = frozenset(
    {"Dog", "Engine", "Environmental", "Fireworks", "Gun", "Human vocal", "Noise", "Siren"}
)
BINOMIAL = re.compile(r"^[A-Z][a-z]+ [a-z][a-z-]*$")
MatchKind = Literal["scientific_name", "common_name"]


@dataclass(frozen=True, slots=True)
class ModelLabel:
    index: int
    model_label: str
    scientific_name: str
    common_name: str
    is_bird: bool


@dataclass(frozen=True, slots=True)
class SpeciesLink:
    species_id: str | None = None
    common_name_zh: str | None = None
    common_name_en: str | None = None
    match: MatchKind | None = None

    @property
    def mapped(self) -> bool:
        return self.species_id is not None


def split_model_label(raw: str) -> tuple[str, str]:
    """``'Turdus merula_Eurasian Blackbird'`` -> ``('Turdus merula', 'Eurasian Blackbird')``."""
    if "_" in raw:
        scientific, common = raw.split("_", 1)
        return scientific.strip(), common.strip()
    return raw.strip(), ""


def parse_model_labels(lines: list[str]) -> list[ModelLabel]:
    labels: list[ModelLabel] = []
    for index, line in enumerate(lines):
        raw = line.strip()
        if not raw:
            raise ValueError(f"label line {index + 1} is empty")
        scientific, common = split_model_label(raw)
        is_bird = scientific not in NON_BIRD_LABELS and BINOMIAL.match(scientific) is not None
        labels.append(
            ModelLabel(
                index=index,
                model_label=raw,
                scientific_name=scientific,
                common_name=common,
                is_bird=is_bird,
            )
        )
    return labels


def load_model_labels(path: Path) -> list[ModelLabel]:
    resolved = path.expanduser().resolve()
    if not resolved.is_file():
        raise FileNotFoundError(f"BirdNET label file not found: {resolved}")
    lines = resolved.read_text(encoding="utf-8-sig").splitlines()
    labels = parse_model_labels([line for line in lines if line.strip()])
    if not any(label.is_bird for label in labels):
        raise ValueError("BirdNET label file contains no bird species")
    return labels


@dataclass(frozen=True, slots=True)
class CatalogIndex:
    by_scientific_name: dict[str, Taxon]
    by_common_name: dict[str, Taxon | None]

    @classmethod
    def build(cls, taxa: list[Taxon]) -> CatalogIndex:
        by_scientific = {taxon.scientific_name.casefold(): taxon for taxon in taxa}
        groups: dict[str, list[Taxon]] = defaultdict(list)
        for taxon in taxa:
            if taxon.common_name_en:
                groups[taxon.common_name_en.casefold()].append(taxon)
        # An ambiguous English name must never decide a species on its own.
        by_common: dict[str, Taxon | None] = {
            name: (members[0] if len(members) == 1 else None) for name, members in groups.items()
        }
        return cls(by_scientific_name=by_scientific, by_common_name=by_common)

    def link(self, label: ModelLabel) -> SpeciesLink:
        taxon = self.by_scientific_name.get(label.scientific_name.casefold())
        if taxon is not None:
            return SpeciesLink(
                species_id=taxon.species_id,
                common_name_zh=taxon.common_name_zh,
                common_name_en=taxon.common_name_en or label.common_name or None,
                match="scientific_name",
            )
        if label.common_name:
            by_name = self.by_common_name.get(label.common_name.casefold())
            if by_name is not None:
                return SpeciesLink(
                    species_id=by_name.species_id,
                    common_name_zh=by_name.common_name_zh,
                    common_name_en=by_name.common_name_en or label.common_name,
                    match="common_name",
                )
        return SpeciesLink()


def link_labels(labels: list[ModelLabel], index: CatalogIndex | None) -> list[SpeciesLink]:
    if index is None:
        return [SpeciesLink() for _ in labels]
    return [index.link(label) if label.is_bird else SpeciesLink() for label in labels]


def label_summary(
    labels: list[ModelLabel],
    links: list[SpeciesLink],
    *,
    labels_sha256: str | None,
) -> dict[str, object]:
    bird_labels = [label for label in labels if label.is_bird]
    mapped = sum(1 for label, link in zip(labels, links, strict=True) if label.is_bird and link.mapped)
    by_common = sum(
        1 for label, link in zip(labels, links, strict=True) if label.is_bird and link.match == "common_name"
    )
    return {
        "count": len(labels),
        "bird_classes": len(bird_labels),
        "non_bird_classes": len(labels) - len(bird_labels),
        "mapped_classes": mapped,
        "mapped_by_common_name": by_common,
        "unmapped_classes": len(bird_labels) - mapped,
        "sha256": labels_sha256,
    }
