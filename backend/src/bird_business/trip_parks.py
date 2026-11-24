from bird_business.community_geo import gcj

PARKS = (
    ("北京奥林匹克森林公园", 40.01770, 116.38606, "Q7089073"),
    ("北京北海公园", 39.92444, 116.38306, "Q133650"),
    ("北京玉渊潭公园", 39.91770, 116.31090, "Q12011122"),
    ("上海世纪公园", 31.21800, 121.54690, "Q847713"),
    ("上海植物园", 31.14778, 121.43806, "Q2371438"),
    ("杭州西溪国家湿地公园", 30.27056, 120.06250, "Q1089272"),
    ("深圳湾公园", 22.52450, 113.98810, "Q20716864"),
    ("武汉东湖", 30.55830, 114.40000, "Q845631"),
    ("香港湿地公园", 22.46865, 114.00514, "Q3238222"),
)


def park_points():
    for name, lat, lon, wikidata in PARKS:
        latitude, longitude = gcj(lat, lon, "WGS84")
        yield {
            "name": name,
            "point": {"latitude": round(latitude, 5), "longitude": round(longitude, 5)},
            "source": "https://www.wikidata.org/wiki/" + wikidata,
        }
