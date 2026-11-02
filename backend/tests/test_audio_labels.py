from __future__ import annotations

import pytest

from bird_audio.labels import (
    NON_BIRD_LABELS,
    CatalogIndex,
    label_summary,
    link_labels,
    load_model_labels,
    parse_model_labels,
    split_model_label,
)
from bird_common.catalog import Taxon

LABELS = [
    "Turdus merula_Eurasian Blackbird",
    "Parus major_Great Tit",
    "Cyanistes caeruleus_Eurasian Blue Tit",
    "Pica pica_Eurasian Magpie",
    "Corvus corone_Carrion Crow",
    "Human vocal_Human vocal",
    "Dog_Dog",
]


def taxon(species_id: str, scientific: str, zh: str | None = None, en: str | None = None) -> Taxon:
    return Taxon(
        species_id=species_id,
        scientific_name=scientific,
        common_name_zh=zh,
        common_name_en=en,
        order=None,
        family=None,
    )


def test_split_model_label_variants() -> None:
    assert split_model_label("Turdus merula_Eurasian Blackbird") == ("Turdus merula", "Eurasian Blackbird")
    assert split_model_label("Turdus merula_") == ("Turdus merula", "")
    assert split_model_label("Turdus merula") == ("Turdus merula", "")


def test_parse_marks_non_bird_classes() -> None:
    labels = parse_model_labels(LABELS)
    assert [label.index for label in labels] == list(range(len(LABELS)))
    assert [label.is_bird for label in labels] == [True] * 5 + [False] * 2
    assert {"Human vocal", "Dog", "Siren", "Noise", "Environmental"} <= NON_BIRD_LABELS
    assert labels[5].scientific_name == "Human vocal"
    assert labels[0].common_name == "Eurasian Blackbird"


def test_parse_rejects_blank_lines() -> None:
    with pytest.raises(ValueError, match="empty"):
        parse_model_labels(["Turdus merula_Eurasian Blackbird", "   "])


def test_parse_rejects_file_without_birds() -> None:
    with pytest.raises(ValueError, match="no bird species"):
        load_model_labels_from(["Dog_Dog", "Noise_Noise"])


def load_model_labels_from(lines: list[str]) -> list:
    import tempfile
    from pathlib import Path

    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "labels.txt"
        path.write_text("\n".join(lines), encoding="utf-8")
        return load_model_labels(path)


def test_load_model_labels_handles_bom_and_blank_lines(tmp_path) -> None:
    path = tmp_path / "labels.txt"
    path.write_bytes(b"\xef\xbb\xbfTurdus merula_Eurasian Blackbird\n\nParus major_Great Tit\n")
    labels = load_model_labels(path)
    assert [label.scientific_name for label in labels] == ["Turdus merula", "Parus major"]


def test_load_model_labels_missing_file(tmp_path) -> None:
    with pytest.raises(FileNotFoundError):
        load_model_labels(tmp_path / "missing.txt")


def test_catalog_index_links_scientific_then_common_name() -> None:
    taxa = [
        taxon("turdus", "Turdus merula", "乌鸫", "Eurasian Blackbird"),
        taxon("parus", "Parus major", "大山雀", "Great Tit"),
    ]
    index = CatalogIndex.build(taxa)
    labels = parse_model_labels(LABELS + ["Turdus merula_Blackbird (renamed)"])
    links = link_labels(labels, index)
    assert links[0].species_id == "turdus"
    assert links[0].match == "scientific_name"
    assert links[0].common_name_zh == "乌鸫"
    assert links[1].species_id == "parus"
    # The catalog's scientific name wins over a divergent BirdNET common name.
    assert links[-1].species_id == "turdus"
    assert links[-1].match == "scientific_name"
    assert links[5].mapped is False


def test_catalog_index_uses_unique_common_name_when_scientific_name_is_unknown() -> None:
    taxa = [taxon("parus", "Parus cinereus", "苍背山雀", "Great Tit")]
    index = CatalogIndex.build(taxa)
    label = parse_model_labels(["Parus major_Great Tit"])[0]
    link = index.link(label)
    assert link.species_id == "parus"
    assert link.match == "common_name"


def test_catalog_index_ignores_ambiguous_common_names() -> None:
    taxa = [
        taxon("a", "Parus major", "大山雀", "Great Tit"),
        taxon("b", "Parus cinereus", "苍背山雀", "Great Tit"),
    ]
    index = CatalogIndex.build(taxa)
    label = parse_model_labels(["Parus unknown_Great Tit"])[0]
    assert index.link(label).mapped is False


def test_link_labels_without_catalog_keeps_everything_unmapped() -> None:
    labels = parse_model_labels(LABELS)
    links = link_labels(labels, None)
    assert len(links) == len(labels)
    assert all(not link.mapped for link in links)


def test_label_summary_counts_mapping_methods() -> None:
    taxa = [
        taxon("turdus", "Turdus merula", "乌鸫", "Eurasian Blackbird"),
        taxon("parus", "Parus cinereus", "苍背山雀", "Great Tit"),
    ]
    labels = parse_model_labels(LABELS)
    links = link_labels(labels, CatalogIndex.build(taxa))
    summary = label_summary(labels, links, labels_sha256="deadbeef")
    assert summary["count"] == len(LABELS)
    assert summary["bird_classes"] == 5
    assert summary["non_bird_classes"] == 2
    assert summary["mapped_classes"] == 2
    assert summary["mapped_by_common_name"] == 1
    assert summary["unmapped_classes"] == 3
    assert summary["sha256"] == "deadbeef"
