import json
import re
from datetime import timedelta

from bird_business.field_guide import field_marks, guide
from bird_business.place_names import chinese_place
from bird_business.trip_advice import weather_at
from bird_business.trip_parks import PARK_CONTEXT


class TripEvidence:
    def __init__(self, database, point, start, hours, sites, parks):
        self.database = database
        self.point = point
        self.start = start
        self.hours = hours
        self.sites = {f"A{index}": site for index, site in enumerate(sites, 1)}
        self.parks = {f"P{index}": park for index, park in enumerate(parks, 1)}
        self.sources = {"F0": "公开地图鸟讯检索（过去一年）", "W0": "出发区域天气 · MET Norway"}
        self.sources.update({key: site["name"] + "一带的公开鸟讯" for key, site in self.sites.items()})
        self.sources.update({key: park["name"] + " · Wikidata 公共地点" for key, park in self.parks.items()})
        for key, site in self.sites.items():
            site["name"] = chinese_place(site["name"])
            point = site["point"]
            site["id"] = key
            # Province labels alone do not identify separate public grid cells.
            site["displayName"] = (
                f"{site['name']}附近公开区域（{point['latitude']:.1f}°，{point['longitude']:.1f}°）"
            )
            self.sources[key] = site["displayName"] + " · 历史鸟讯"
        self.source_urls = {}
        for key, park in self.parks.items():
            park["id"] = key
            context = PARK_CONTEXT.get(park["source"])
            park["context"] = {**context, "sources": []} if context else None
            if context:
                for source in context["sources"]:
                    ref = next(
                        (ref for ref, url in self.source_urls.items() if url == source["url"]),
                        "C" + str(len(self.source_urls) + 1),
                    )
                    self.sources[ref] = source["label"] + " · " + source["date"]
                    self.source_urls[ref] = source["url"]
                    park["context"]["sources"].append({**source, "id": ref})
            park["nearbyAreas"] = [
                area
                for area, site in self.sites.items()
                if round(park["point"]["latitude"], 1) == round(site["point"]["latitude"], 1)
                and round(park["point"]["longitude"], 1) == round(site["point"]["longitude"], 1)
            ]
        self.weather = {}
        self.guides = {}

    def forecast(self, area):
        if area not in self.weather:
            place = {**self.sites, **self.parks}.get(area)
            point = place["point"] if place else self.point
            source = "W0" if not place else "W" + str(1 + list({**self.sites, **self.parks}).index(area))
            name = place["name"] + "一带" if place else "出发区域"
            self.weather[area] = {**weather_at(point, self.start, self.hours), "id": source, "area": name}
            self.sources[source] = name + "天气 · MET Norway"
        return self.weather[area]

    def initial(self):
        return {
            "F0": {
                "areas": [
                    {
                        "id": key,
                        "name": site["name"],
                        "displayName": site["displayName"],
                        "km": site["km"],
                        "latest": site["latest"],
                        "records": site["count"],
                        "speciesCount": site["richness"],
                        "birds": [bird["name"] for bird in site["birds"]],
                    }
                    for key, site in self.sites.items()
                ],
                "parks": [
                    {
                        "id": key,
                        "name": park["name"],
                        "km": park["km"],
                        "nearbyAreas": park["nearbyAreas"],
                        "context": park["context"],
                    }
                    for key, park in self.parks.items()
                ],
            },
            "W0": self.forecast("origin"),
            "guides": list(self.guides.values()),
        }

    def tools(self):
        def tool(name, description, key, values=None):
            prop = {"type": "string"}
            if values:
                prop["enum"] = values
            return {
                "type": "function",
                "function": {
                    "name": name,
                    "description": description,
                    "parameters": {
                        "type": "object",
                        "properties": {key: prop},
                        "required": [key],
                        "additionalProperties": False,
                    },
                },
            }

        tools = [
            tool(
                "get_forecast",
                "查询本次行程某个候选区域的逐时天气。",
                "area",
                ["origin", *self.sites, *self.parks],
            ),
            tool("get_species_guide", "按中文名、英文名或学名查鸟种图鉴的形态、生境与活动资料。", "name"),
        ]
        if self.sites:
            tools.append(
                tool(
                    "get_sightings",
                    "查看该区域的鸟种、记录数、最近日期、同月份记录数。",
                    "area",
                    list(self.sites),
                )
            )
        return tools

    def call(self, name, arguments):
        try:
            args = json.loads(arguments)
        except ValueError:
            return {"error": "无效 JSON 参数"}
        if not isinstance(args, dict) or len(args) != 1:
            return {"error": "参数格式无效"}
        area = args.get("area")
        if isinstance(area, str):
            if name == "get_forecast" and area in ("origin", *self.sites, *self.parks):
                return self.forecast(area)
            if name == "get_sightings" and area in self.sites:
                site = self.sites[area]
                return {
                    "id": area,
                    "name": site["name"],
                    "seasonal": site["seasonal"],
                    "birds": [
                        {key: bird[key] for key in ("name", "latest", "count")} for bird in site["birds"]
                    ],
                }
        term = args.get("name")
        if name == "get_species_guide" and isinstance(term, str) and 2 <= len(term.strip()) <= 80:
            with self.database.transaction() as db:
                matches = db.execute(
                    """SELECT id,name,english,scientific FROM taxa
                    WHERE instr(lower(name),lower(?))>0 OR english=? COLLATE NOCASE
                    OR scientific=? COLLATE NOCASE
                    ORDER BY (name=?) DESC,scientific LIMIT 3""",
                    (term, term, term, term),
                ).fetchall()
            result = []
            for bird in matches:
                key = bird["id"]
                if key not in self.guides:
                    profile = guide(self.database.catalog_dir, key)
                    source = "G" + str(len(self.guides) + 1)
                    label = bird["name"] or bird["english"]
                    self.guides[key] = {
                        "id": source,
                        "name": label,
                        "speciesId": key,
                        "fields": profile["fields"],
                        "inferred": profile["inferred"],
                        **field_marks(bird["scientific"]),
                    }
                    self.sources[source] = label + " · 鸟种图鉴"
                result.append(self.guides[key])
            return {"matches": result}
        return {"error": "工具或参数不在本轮可用范围内"}

    def validate(self, answer):
        destinations = {**self.sites, **self.parks}
        if (
            not set(answer.destinations) <= destinations.keys()
            or not set(answer.sources) <= self.sources.keys()
        ):
            raise ValueError("unknown reference")
        if len(answer.destinations) != len(set(answer.destinations)):
            raise ValueError("duplicate destination")
        visit_ids = [visit.destination for visit in answer.visits]
        if not set(visit_ids) <= set(answer.destinations) or len(visit_ids) != len(set(visit_ids)):
            raise ValueError("unlinked visit")
        text = answer.model_dump_json()
        if any(
            ref not in destinations
            for ref in re.findall(r"(?<![A-Za-z0-9_])[AP]\d{1,3}(?![A-Za-z0-9_])", text)
        ):
            raise ValueError("unknown location in prose")
        offsets = [stage.offsetMinutes for stage in answer.stages]
        if sorted(set(offsets)) != offsets or any(offset > self.hours * 60 for offset in offsets):
            raise ValueError("invalid itinerary")

    def render(self, answer):
        places = {**self.sites, **self.parks}

        def named(value):
            return re.sub(
                r"(?<![A-Za-z0-9_])[AP]\d{1,3}(?![A-Za-z0-9_])",
                lambda match: places[match[0]].get("displayName", places[match[0]]["name"]),
                value,
            )

        brief = answer.brief.model_dump() if answer.brief else None
        if brief:
            brief = {
                key: named(value) if isinstance(value, str) else [named(line) for line in value]
                for key, value in brief.items()
            }
        references = list(
            dict.fromkeys(
                [
                    *answer.destinations,
                    *(key for key in answer.sources if key in places),
                    *re.findall(r"(?<![A-Za-z0-9_])[AP]\d{1,3}(?![A-Za-z0-9_])", answer.model_dump_json()),
                ]
            )
        )
        source_ids = list(dict.fromkeys([*answer.sources, *answer.destinations]))
        for key in answer.destinations:
            context = self.parks.get(key, {}).get("context")
            for source in context["sources"] if context else []:
                if source["id"] not in source_ids:
                    source_ids.append(source["id"])
        visits = []
        for visit in answer.visits:
            place = places[visit.destination]
            visits.append(
                {
                    "destination": visit.destination,
                    "name": place.get("displayName", place["name"]),
                    "why": named(visit.why),
                    "habitats": [named(line) for line in visit.habitats],
                    "watchFor": [named(line) for line in visit.watchFor],
                    "timing": named(visit.timing),
                    "uncertainty": named(visit.uncertainty),
                }
            )
        return {
            "schemaVersion": 4,
            "answer": named(answer.answer),
            "brief": brief,
            "referenceMap": [
                {
                    "id": key,
                    "name": places[key].get("displayName", places[key]["name"]),
                    "kind": "area" if key in self.sites else "park",
                    "point": places[key]["point"],
                    "km": places[key]["km"],
                    "precisionLabel": "约十公里公开区域 · 非精确拍摄点"
                    if key in self.sites
                    else "公园参考点 · 非鸟类拍摄点或入口",
                }
                for key in references
            ],
            "visits": visits,
            "sources": [
                {
                    "id": key,
                    "label": self.sources[key],
                    **({"url": self.source_urls[key]} if key in self.source_urls else {}),
                }
                for key in source_ids
            ],
            "stops": [self.sites[key] for key in answer.destinations if key in self.sites],
            "parks": [self.parks[key] for key in answer.destinations if key in self.parks],
            "weatherCards": list(self.weather.values()),
            "guideCards": [
                {"id": row["speciesId"], "name": row["name"]}
                for row in self.guides.values()
                if row["id"] in answer.sources
            ],
            "stages": [
                {
                    "time": (self.start + timedelta(minutes=stage.offsetMinutes)).strftime("%H:%M"),
                    "action": named(stage.action),
                }
                for stage in answer.stages
            ],
        }
