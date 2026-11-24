import json
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from time import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from bird_business.community_geo import gcj

BEIJING = timezone(timedelta(hours=8))


def read_json(request, timeout, limit):
    with urlopen(request, timeout=timeout) as response:
        content = response.read(limit + 1)
    if len(content) > limit:
        raise ValueError("response too large")
    return json.loads(content)


@lru_cache(maxsize=128)
def forecast_grid(latitude, longitude, hour_bucket):
    query = urlencode({"lat": latitude, "lon": longitude})
    request = Request(
        "https://api.met.no/weatherapi/locationforecast/2.0/compact?" + query,
        headers={"User-Agent": "BirdAssistant/1.0 (https://api.auroraliu.cn:8080)"},
    )
    return read_json(request, 5, 450000)["properties"]


def weather_at(point, start, duration):
    unavailable = {"available": False, "hours": [], "source": "MET Norway · CC BY 4.0"}
    lat, lon = point["latitude"], point["longitude"]
    shifted_lat, shifted_lon = gcj(lat, lon, "WGS84")
    try:
        forecast = forecast_grid(
            round(2 * lat - shifted_lat, 1), round(2 * lon - shifted_lon, 1), int(time() // 3600)
        )
        hours = []
        for row in forecast["timeseries"]:
            instant = datetime.fromisoformat(row["time"]).astimezone(BEIJING)
            if not start <= instant < start + timedelta(hours=duration):
                continue
            data = row["data"]
            details = data["instant"]["details"]
            rain = data.get("next_1_hours", {}).get("details", {}).get("precipitation_amount")
            hours.append(
                {
                    "hour": instant.strftime("%H:%M"),
                    "temp": details["air_temperature"],
                    "wind": details["wind_speed"],
                    "rain": rain,
                }
            )
        return {
            **unavailable,
            "available": bool(hours),
            "hours": hours,
            "updated": forecast["meta"]["updated_at"],
        }
    except (OSError, ValueError, KeyError, TypeError):
        return unavailable
