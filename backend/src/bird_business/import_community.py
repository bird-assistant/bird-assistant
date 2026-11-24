import json
import re
from datetime import date
from time import sleep
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from bird_business.community_geo import display_point
from bird_business.community_store import CommunityStore, encode, now
from bird_business.config import BusinessSettings
from bird_business.field_guide import media_candidate

DATASET = "50c9509d-22c7-4a22-a47d-8c48425ef4a7"
DATASETS = {DATASET: "iNaturalist", "6ff8b3b0-ef0f-4f79-a310-5a5615c6aa0b": "Birda"}
LICENCES = {"publicdomain/zero/1.0": "CC0 1.0", "licenses/by/4.0": "CC BY 4.0"}


def snapshot(store: CommunityStore, rows: list[dict]) -> int:
    updated = now()
    seen = set()
    with store.transaction() as db:
        catalogue = {row["scientific"]: row for row in db.execute("SELECT * FROM taxa WHERE sensitive=0")}
        for record in rows:
            source = DATASETS.get(record.get("datasetKey"))
            licence = re.fullmatch(
                r"https?://creativecommons\.org/(publicdomain/zero/1\.0|licenses/by/4\.0)(?:/legalcode)?/?",
                record.get("license") or "",
            )
            if (
                not source
                or record.get("occurrenceStatus") not in {"PRESENT", "DETECTED"}
                or not licence
                or record.get("informationWithheld")
                or record.get("dataGeneralizations")
                or not isinstance(record.get("key"), int)
            ):
                continue
            uncertainty = record.get("coordinateUncertaintyInMeters")
            if uncertainty is not None and not 0 <= uncertainty <= 10000:
                continue
            species = catalogue.get(record.get("species"))
            if species is None:
                continue
            try:
                day = date.fromisoformat(record["eventDate"][:10]).isoformat()
                precise = uncertainty is not None and uncertainty <= 1000
                point = display_point(
                    {
                        "latitude": float(record["decimalLatitude"]),
                        "longitude": float(record["decimalLongitude"]),
                        "system": "WGS84",
                    },
                    public=not precise,
                )
                if precise:
                    point = {key: round(value, 2) for key, value in point.items()}
            except (KeyError, ValueError, TypeError):
                continue
            key = "gbif_" + str(record["key"])
            name = species["name"] or species["english"] or species["scientific"]
            display = dict(
                speciesId=species["id"],
                speciesName=name,
                title=name,
                source=source + " · GBIF",
                sourceUrl="https://www.gbif.org/occurrence/" + str(record["key"]),
                dataset=record["datasetKey"],
                licence=LICENCES[licence[1]],
                licenceUrl="https://creativecommons.org/" + licence[1] + "/",
                attribution=record.get("rightsHolder")
                or record.get("recordedBy")
                or source + " contributors",
                precisionLabel="约一公里公开网格" if precise else "约十公里公开网格",
                sourceModified=record.get("modified"),
                sourcePhoto=record.get("sourcePhoto"),
                date=day,
                body="",
                anonymous=False,
                publicName=source,
                displayLocation=point,
                coordinateSystem="GCJ-02",
                placeName=record.get("stateProvince") or "公开区域",
                media=None,
                camera={},
            )
            db.execute(
                "INSERT INTO publications VALUES(?,'gbif',NULL,'map',NULL,'approved',?,?,?,?,?,?) "
                "ON CONFLICT(id) DO UPDATE SET display=excluded.display,species=excluded.species,"
                "lat=excluded.lat,lon=excluded.lon,day=excluded.day,created=excluded.created,"
                "status=CASE WHEN publications.status='rejected' THEN 'rejected' ELSE 'approved' END",
                (key, encode(display), species["id"], point["latitude"], point["longitude"], day, updated),
            )
            seen.add(key)
        db.execute(
            "UPDATE publications SET status='withdrawn' WHERE owner='gbif' "
            "AND created!=? AND status='approved'",
            (updated,),
        )
    return len(seen)


def fetch_page(dataset, offset):
    params = dict(
        datasetKey=dataset,
        country="CN",
        taxonKey=212,
        hasCoordinate="true",
        license=["CC0_1_0", "CC_BY_4_0"],
        limit=300,
        offset=offset,
    )
    url = "https://api.gbif.org/v1/occurrence/search?" + urlencode(params, doseq=True)
    for attempt in range(3):
        try:
            with urlopen(
                Request(url, headers={"User-Agent": "BirdAssistant/1.0 community observations"}), timeout=60
            ) as reply:
                return json.load(reply)
        except (OSError, ValueError):
            if attempt == 2:
                raise
            sleep(2**attempt)


def collect_rows(dataset):
    rows = {}
    offset = 0
    fields = [
        "key",
        "datasetKey",
        "occurrenceStatus",
        "species",
        "license",
        "informationWithheld",
        "dataGeneralizations",
        "coordinateUncertaintyInMeters",
        "eventDate",
        "decimalLatitude",
        "decimalLongitude",
        "rightsHolder",
        "recordedBy",
        "modified",
        "stateProvince",
    ]
    while True:
        page = fetch_page(dataset, offset)
        batch = page["results"]
        if page["offset"] != offset or not isinstance(batch, list) or not batch and offset < page["count"]:
            raise ValueError("incomplete GBIF page")
        for record in batch:
            rows[record["key"]] = {field: record[field] for field in fields if field in record}
            rows[record["key"]]["sourcePhoto"] = media_candidate(record, record.get("species"))
        offset += len(batch)
        if page["endOfRecords"] or offset == page["count"]:
            if len(rows) != page["count"]:
                raise ValueError("incomplete GBIF snapshot")
            return rows.values()
        if not batch:
            raise ValueError("empty GBIF page")


def main():
    settings = BusinessSettings()
    rows = [row for dataset in DATASETS for row in collect_rows(dataset)]
    store = CommunityStore(settings.database_path, settings.catalog_path)
    try:
        print("GBIF community records fetched:", len(rows), "accepted:", snapshot(store, rows))
    finally:
        store.db.close()


if __name__ == "__main__":
    main()
