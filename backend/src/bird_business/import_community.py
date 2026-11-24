import json
import re
from datetime import date
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from bird_business.community_geo import display_point
from bird_business.community_store import CommunityStore, encode, now
from bird_business.config import BusinessSettings

DATASET = "50c9509d-22c7-4a22-a47d-8c48425ef4a7"


def snapshot(store: CommunityStore, rows: list[dict]) -> int:
    updated = now()
    seen = set()
    with store.transaction() as db:
        for record in rows:
            if (
                record.get("datasetKey") != DATASET
                or record.get("occurrenceStatus") not in {"PRESENT", "DETECTED"}
                or not re.fullmatch(
                    r"https?://creativecommons.org/publicdomain/zero/1.0/(legalcode)?",
                    record.get("license", ""),
                )
                or record.get("informationWithheld")
                or record.get("dataGeneralizations")
                or not isinstance(record.get("key"), int)
            ):
                continue
            uncertainty = record.get("coordinateUncertaintyInMeters")
            if uncertainty is None or not 0 <= uncertainty <= 10000:
                continue
            species = db.execute(
                "SELECT * FROM taxa WHERE scientific=? AND sensitive=0 LIMIT 1", (record.get("species"),)
            ).fetchone()
            if species is None:
                continue
            try:
                day = date.fromisoformat(record["eventDate"][:10]).isoformat()
                point = display_point(
                    {
                        "latitude": float(record["decimalLatitude"]),
                        "longitude": float(record["decimalLongitude"]),
                        "system": "WGS84",
                    }
                )
            except (KeyError, ValueError, TypeError):
                continue
            key = "gbif_" + str(record["key"])
            name = species["name"] or species["english"] or species["scientific"]
            display = dict(
                speciesId=species["id"],
                speciesName=name,
                title=name,
                source="iNaturalist · GBIF",
                sourceUrl="https://www.gbif.org/occurrence/" + str(record["key"]),
                dataset=DATASET,
                licence="CC0 1.0",
                attribution=record.get("recordedBy") or "iNaturalist contributors",
                sourceModified=record.get("modified"),
                date=day,
                body="",
                anonymous=False,
                publicName="iNaturalist",
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


def main():
    settings = BusinessSettings()
    params = dict(
        datasetKey=DATASET,
        country="CN",
        taxonKey="212",
        license="CC0_1_0",
        limit=200,
    )
    url = "https://api.gbif.org/v1/occurrence/search?" + urlencode(params)
    with urlopen(
        Request(url, headers={"User-Agent": "BirdAssistant/1.0 community observations"}), timeout=75
    ) as reply:
        response = json.load(reply)
    rows = response["results"]
    if not isinstance(rows, list) or not rows and response["count"]:
        raise ValueError("incomplete GBIF response")
    store = CommunityStore(settings.database_path, settings.catalog_path)
    try:
        print("iNaturalist/GBIF observations:", snapshot(store, rows))
    finally:
        store.db.close()


if __name__ == "__main__":
    main()
