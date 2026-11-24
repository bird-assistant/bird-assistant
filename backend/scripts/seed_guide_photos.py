import argparse
import csv
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from bird_business.field_guide import fetch_reference

COMMON = """Passer montanus;Passer domesticus;Parus major;Parus minor;Cyanistes caeruleus;Poecile palustris;
Spilopelia chinensis;Streptopelia orientalis;Columba livia;Pycnonotus sinensis;Pycnonotus jocosus;
Pica serica;Pica pica;Cyanopica cyanus;Urocissa erythroryncha;Garrulus glandarius;Corvus corone;
Corvus macrorhynchos;Turdus merula;Turdus mandarinus;Turdus eunomus;Phoenicurus auroreus;
Sturnus vulgaris;Spodiopsar cineraceus;Acridotheres cristatellus;Zosterops simplex;Zosterops japonicus;
Egretta garzetta;Ardea alba;Ardea cinerea;Ardeola bacchus;Nycticorax nycticorax;Bubulcus coromandus;
Alcedo atthis;Halcyon smyrnensis;Motacilla alba;Motacilla cinerea;Hirundo rustica;Hirundo daurica;
Anas platyrhynchos;Anas zonorhyncha;Anas poecilorhyncha;Anas crecca;Mareca falcata;Spatula clypeata;
Gallinula chloropus;Fulica atra;Phalacrocorax carbo;Chroicocephalus ridibundus;Podiceps cristatus;
Tachybaptus ruficollis;Upupa epops;Dendrocopos major;Picus canus;Fringilla coelebs;Fringilla montifringilla;
Carduelis carduelis;Chloris sinica;Emberiza elegans;Emberiza spodocephala;Lonchura punctulata;
Lanius schach;Lanius cristatus;Aegithalos concinnus;Aegithalos caudatus;Orthotomus sutorius;
Copsychus saularis;Garrulax canorus;Leiothrix lutea;Dendrocitta formosae;Myophonus caeruleus;
Periparus venustulus;Periparus ater;Sitta europaea;Ficedula mugimaki;Ficedula zanthopygia;
Saxicola stejnegeri;Phoenicurus auroreus;Tarsiger cyanurus;Luscinia svecica;Monticola solitarius;
Phylloscopus inornatus;Phylloscopus proregulus;Phylloscopus borealis;Acrocephalus orientalis;
Pernis ptilorhynchus;Falco tinnunculus;Falco peregrinus;Milvus migrans;Accipiter nisus;
Dendrocopos leucotos;Jynx torquilla;Picumnus innominatus;Cuculus canorus;Eudynamys scolopaceus;
Lanius bucephalus;Pyrrhula pyrrhula;Eophona migratoria;Eophona personata;Emberiza aureola;
Anser cygnoides;Cygnus cygnus;Aix galericulata;Aythya fuligula;Mergus merganser;Ardea purpurea;
Tringa ochropus;Tringa glareola;Actitis hypoleucos;Vanellus vanellus;Himantopus himantopus"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--names", default=COMMON, help="scientific names separated by semicolons")
    args = parser.parse_args()
    directory = Path(__file__).resolve().parents[1] / "config/catalog"
    directory.joinpath("guide_images").mkdir(exist_ok=True)
    manifest = directory / "guide_photos.json"
    photos = json.loads(manifest.read_text()) if manifest.exists() else {}
    names = {name.strip() for name in args.names.split(";")}
    with (directory / "avilist_v2026_global.csv").open(encoding="utf-8-sig") as src:
        taxa = [
            r for r in csv.DictReader(src) if r["scientific_name"] in names and r["species_id"] not in photos
        ]

    def collect(row):
        try:
            return row["species_id"], fetch_reference(row["scientific_name"])
        except (OSError, ValueError) as exc:
            print(row["scientific_name"], type(exc).__name__, flush=True)
            return row["species_id"], None

    with ThreadPoolExecutor(max_workers=3) as pool:
        for species, result in pool.map(collect, taxa):
            if result:
                metadata, content = result
                (directory / "guide_images" / (species + ".jpg")).write_bytes(content)
                photos[species] = metadata
    manifest.write_text(json.dumps(photos, ensure_ascii=False, sort_keys=True, indent=2) + "\n")
    print(len(photos), "reference photographs", flush=True)


if __name__ == "__main__":
    main()
