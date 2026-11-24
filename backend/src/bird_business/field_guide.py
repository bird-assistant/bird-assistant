import json
import re
from functools import lru_cache
from io import BytesIO
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from PIL import Image, ImageOps

DATASET = "50c9509d-22c7-4a22-a47d-8c48425ef4a7"
SOURCE = "Tobias et al. · AVONET · CC BY 4.0"
DOI = "https://doi.org/10.6084/m9.figshare.16586228.v7"
MARKS = {
    "Passer montanus": ("留意栗色头顶和白颊上的黑点。", "tree-sparrow"),
    "Passer domesticus": (
        "成年雄鸟头顶灰色、喉部黑色。雌鸟与幼鸟面纹较淡，可看眼后浅眉纹。",
        "house-sparrow",
    ),
    "Cyanistes caeruleus": ("先看蓝色头顶和深色贯眼纹，再看黄色腹部。", "blue-tit"),
    "Parus major": ("黑头衬出大片白颊，黄腹中央有一道黑纹。", "great-tit"),
}


def field_marks(scientific):
    item = MARKS.get(scientific)
    return (
        {"mark": item[0], "markUrl": "https://www.rspb.org.uk/birds-and-wildlife/" + item[1]} if item else {}
    )


VOCAB = {
    "Coastal": "海岸",
    "Desert": "荒漠",
    "Forest": "森林",
    "Grassland": "草地",
    "Human Modified": "人类活动环境",
    "Marine": "海洋",
    "Riverine": "河流",
    "Rock": "岩地",
    "Shrubland": "灌丛",
    "Wetland": "湿地",
    "Woodland": "疏林",
    "Aquatic predator": "水生动物",
    "Frugivore": "果实",
    "Granivore": "种子",
    "Herbivore aquatic": "水生植物",
    "Herbivore terrestrial": "陆生植物",
    "Invertivore": "无脊椎动物",
    "Nectarivore": "花蜜",
    "Omnivore": "杂食",
    "Scavenger": "腐肉",
    "Vertivore": "脊椎动物",
    "Aerial": "空中活动",
    "Aquatic": "水中活动",
    "Generalist": "多种环境",
    "Insessorial": "栖枝活动",
    "Terrestrial": "地面活动",
}


@lru_cache(maxsize=8)
def read_data(path: Path):
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}


def guide(directory, species):
    traits = read_data(directory / "avonet_traits.json").get(species, {})
    fields = []
    for key, label, unit in [
        ("mass", "体重", "g"),
        ("wing", "翼长", "mm"),
        ("bill", "嘴峰长", "mm"),
        ("tail", "尾长", "mm"),
        ("habitat", "生境", ""),
        ("diet", "食性", ""),
        ("lifestyle", "活动方式", ""),
    ]:
        if key in traits:
            value = traits[key]
            text = f"{value:g} {unit}" if unit else VOCAB.get(value, value)
            fields.append({"key": key, "label": label, "value": text})
    photos = read_data(directory / "guide_photos.json")
    return {
        "fields": fields,
        "source": SOURCE,
        "sourceUrl": DOI,
        "inferred": traits.get("inference") == "YES",
        "photo": photos.get(species),
    }


def media_candidate(record, scientific):
    if (
        record.get("datasetKey") != DATASET
        or record.get("species") != scientific
        or record.get("basisOfRecord") != "HUMAN_OBSERVATION"
    ):
        return None
    for media in record.get("media", []):
        licence = media.get("license", "").replace("http://", "https://").rstrip("/")
        allowed = {
            "https://creativecommons.org/licenses/by/4.0": "CC BY 4.0",
            "https://creativecommons.org/publicdomain/zero/1.0": "CC0 1.0",
        }
        photo = re.fullmatch(
            r"https://inaturalist-open-data\.s3\.amazonaws\.com/photos/(\d+)/original\.(jpg|jpeg|png)",
            media.get("identifier", ""),
            re.I,
        )
        author = media.get("creator") or media.get("rightsHolder")
        if media.get("type") == "StillImage" and licence in allowed and photo and author:
            return {
                "credit": author,
                "license": allowed[licence],
                "licenseUrl": licence + "/",
                "sourceUrl": "https://www.inaturalist.org/photos/" + photo[1],
                "download": f"https://inaturalist-open-data.s3.amazonaws.com/photos/{photo[1]}/medium.{photo[2]}",
            }
    return None


def fetch_bytes(url, limit):
    with urlopen(
        Request(url, headers={"User-Agent": "BirdAssistant/1.0 field guide"}), timeout=6
    ) as response:
        content = response.read(limit + 1)
    if len(content) > limit:
        raise ValueError("reference too large")
    return content


@lru_cache(maxsize=48)
def observation_thumbnail(url):
    if not re.fullmatch(
        r"https://inaturalist-open-data\.s3\.amazonaws\.com/photos/\d+/medium\.(jpg|jpeg|png)", url, re.I
    ):
        raise ValueError("unknown photo")
    with Image.open(BytesIO(fetch_bytes(url, 3000000))) as image:
        if image.width * image.height > 5000000:
            raise ValueError("reference too large")
        rendered = ImageOps.exif_transpose(image).convert("RGB")
        rendered.thumbnail((720, 720))
        output = BytesIO()
        rendered.save(output, "JPEG", quality=82)
        return output.getvalue()


def fetch_reference(scientific):
    query = urlencode(
        {
            "datasetKey": DATASET,
            "scientificName": scientific,
            "mediaType": "StillImage",
            "limit": 30,
            "license": ["CC_BY_4_0", "CC0_1_0"],
        },
        doseq=True,
    )

    for record in json.loads(fetch_bytes("https://api.gbif.org/v1/occurrence/search?" + query, 2000000))[
        "results"
    ]:
        candidate = media_candidate(record, scientific)
        if candidate:
            try:
                return candidate, observation_thumbnail(candidate.pop("download"))
            except ValueError:
                continue
    return None
