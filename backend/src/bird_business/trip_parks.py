from bird_business.community_geo import gcj

PARKS = (
    ("北京颐和园", 39.99750, 116.26889, "Q4132"),
    ("北京圆明园遗址公园", 40.01203, 116.30678, "Q907894"),
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


# Short editorial summaries of public landscape information, not live sightings.
# Checked 2026-11-25; no nest positions, access promises or opening hours.
PARK_CONTEXT = {
    "https://www.wikidata.org/wiki/Q4132": {
        "landscape": [
            "昆明湖开阔水面与万寿山林地构成多样生境。",
            "冬季水鸟与林鸟均有历史调查记录；不表示今天必见。",
        ],
        "observation": (
            "可在允许通行的公共岸线先观察水面，再留意安静林缘；"
            "冰面和封闭水源保护区不可进入。具体人流、结冰和通行情况需现场核实。"
        ),
        "sources": [
            {
                "url": "https://yllhj.beijing.gov.cn/ztxx/kpjd/202312/t20231222_3508035.shtml",
                "label": "北京市园林绿化局 · 颐和园景观资料",
                "date": "2023-12-25",
            },
            {
                "url": "https://www.forestry.gov.cn/c/www/dzbhdt/636488.jhtml",
                "label": "国家林草局 · 颐和园鸟类调查报道",
                "date": "2025-07-31",
            },
        ],
    }
}

# The page date is 2024-11-22, despite the later URL directory.
WINTER_SOURCE = {
    "url": "https://yllhj.beijing.gov.cn/ztxx/anz/anzxd/202510/t20251013_4221720.shtml",
    "label": "北京市园林绿化局 · 北京冬季观鸟导赏图",
    "date": "2024-11-22",
}
for code, landscape, birds in (
    ("Q133650", "大水面与松柏林，往年冬季部分水面不结冰。", ["普通秋沙鸭", "鸳鸯"]),
    ("Q12011122", "历史资料描述冬季不冻水面。", ["鸳鸯", "小鸊鷉"]),
    ("Q7089073", "芦苇与杂木林可供鸟类隐蔽、取食。", ["棕头鸦雀", "燕雀"]),
    ("Q907894", "水域与多样植被并存。", ["黑水鸡", "白骨顶"]),
):
    PARK_CONTEXT["https://www.wikidata.org/wiki/" + code] = {
        "landscape": [landscape],
        "seasonalReference": {"season": "冬季", "birds": birds, "historical": True},
        "observation": "一般建议：在允许通行的公共步道寻找相应生境；当日鸟况、人流和结冰情况需现场确认。",
        "sources": [WINTER_SOURCE],
    }
