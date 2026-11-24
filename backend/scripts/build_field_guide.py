import argparse
import csv
import hashlib
import json
import re
from pathlib import Path
from xml.etree import ElementTree
from zipfile import ZipFile


def build(workbook, catalog):
    if (
        hashlib.md5(workbook.read_bytes(), usedforsecurity=False).hexdigest()
        != "1445afdcfb6df784010c2ca034544bc8"
    ):
        raise ValueError("Expected AVONET Supplementary dataset 1, Figshare v7 file 34480856")
    with catalog.open(encoding="utf-8-sig") as source:
        taxa = {
            row["avibase_id"].lower(): row["species_id"]
            for row in csv.DictReader(source)
            if row["enabled"].lower() == "true" and row["avibase_id"]
        }
    fields = {
        "Mass": "mass",
        "Wing.Length": "wing",
        "Tail.Length": "tail",
        "Beak.Length_Culmen": "bill",
        "Habitat": "habitat",
        "Trophic.Niche": "diet",
        "Primary.Lifestyle": "lifestyle",
        "Inference": "inference",
    }
    profiles = {}
    with ZipFile(workbook) as archive:
        strings = [
            "".join(node.itertext()) for node in ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
        ]
        headers = {}
        for _, row in ElementTree.iterparse(archive.open("xl/worksheets/sheet3.xml")):
            if not row.tag.endswith("}row"):
                continue
            cells = {}
            for cell in row:
                value = cell.findtext("{*}v")
                if value is not None:
                    cells[re.sub(r"\d", "", cell.attrib["r"])] = (
                        strings[int(value)] if cell.get("t") == "s" else value
                    )
            if not headers:
                headers = cells
                continue
            values = {headers[column]: value for column, value in cells.items() if column in headers}
            key = taxa.get(values.get("Avibase.ID2", "").lower())
            if key:
                if key in profiles:
                    raise ValueError("Ambiguous Avibase concept " + key)
                traits = {}
                for field, name in fields.items():
                    value = values.get(field)
                    if value and value != "NA":
                        traits[name] = (
                            round(float(value), 1) if name in {"mass", "wing", "tail", "bill"} else value
                        )
                profiles[key] = traits
            row.clear()
    return profiles


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("workbook", type=Path)
    parser.add_argument(
        "--catalog",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "config/catalog/avilist_v2026_global.csv",
    )
    args = parser.parse_args()
    profiles = build(args.workbook, args.catalog)
    args.catalog.with_name("avonet_traits.json").write_text(
        json.dumps(profiles, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"
    )
    print(len(profiles), "matched species")
