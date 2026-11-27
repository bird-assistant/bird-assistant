from math import asin, cos, pi, radians, sin, sqrt


def gcj(latitude: float, longitude: float, system: str) -> tuple[float, float]:
    if system == "GCJ-02" or not (72.004 <= longitude <= 137.8347 and 0.8293 <= latitude <= 55.8271):
        return latitude, longitude
    east, north = longitude - 105, latitude - 35
    wave = (20 * sin(6 * east * pi) + 20 * sin(2 * east * pi)) * 2 / 3
    lat = (
        -100 + 2 * east + 3 * north + 0.2 * north * north + 0.1 * east * north + 0.2 * sqrt(abs(east)) + wave
    )
    lat += (
        (
            20 * sin(north * pi)
            + 40 * sin(north * pi / 3)
            + 160 * sin(north * pi / 12)
            + 320 * sin(north * pi / 30)
        )
        * 2
        / 3
    )
    lon = 300 + east + 2 * north + 0.1 * east * east + 0.1 * east * north + 0.1 * sqrt(abs(east)) + wave
    lon += (
        (
            20 * sin(east * pi)
            + 40 * sin(east * pi / 3)
            + 150 * sin(east * pi / 12)
            + 300 * sin(east * pi / 30)
        )
        * 2
        / 3
    )
    eccentricity = 0.006693421622965943
    factor = 1 - eccentricity * sin(radians(latitude)) ** 2
    lat /= 6378245 * (1 - eccentricity) / (factor * sqrt(factor)) * pi / 180
    lon /= 6378245 / sqrt(factor) * cos(radians(latitude)) * pi / 180
    return latitude + lat, longitude + lon


def display_point(point: dict, public: bool = True) -> dict:
    lat, lon = gcj(point["latitude"], point["longitude"], point["system"])
    if public:
        lat, lon = round(lat, 1), round(lon, 1)
    return {"latitude": lat, "longitude": lon}


def distance_km(lat, lon, other_lat, other_lon):
    if any(value is None for value in (lat, lon, other_lat, other_lon)):
        return None
    arc = (
        sin(radians(other_lat - lat) / 2) ** 2
        + cos(radians(lat)) * cos(radians(other_lat)) * sin(radians(other_lon - lon) / 2) ** 2
    )
    return 12742 * asin(sqrt(min(1, arc)))
