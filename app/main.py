import os
from datetime import datetime
from typing import Any, Dict, List, Optional

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

DB_API_BASE = os.getenv("DB_API_BASE", "https://v6.db.transport.rest")

app = FastAPI(
    title="Longest Direct Regional Trains",
    description=(
        "Gibt die längsten durchgehenden Regionalzug-Verbindungen (RE/RB/S) "
        "ab einem Startbahnhof zurück, basierend auf v6.db.transport.rest."
    ),
    version="0.1.0",
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost",
        "http://localhost:3000",
        "http://localhost:4173",
        "http://127.0.0.1:8000",
        "http://localhost:8000",
        "https://cognifex.github.io",
        "https://cognifex.github.io/wnt-db",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

class StationInfo(BaseModel):
    id: str
    name: str


class DirectConnection(BaseModel):
    line_name: str
    product: str
    direction: str
    from_station: StationInfo
    to_station: StationInfo
    departure: datetime
    arrival: datetime
    duration_minutes: int
    stops_after_origin: int
    trip_id: str


async def resolve_station_id(client: httpx.AsyncClient, station_query: str) -> StationInfo:
    """
    Nutzt /stations?query=… um eine DB-Station zu finden. Nimmt den besten Treffer.
    """
    params = {
        "query": station_query,
        "limit": 1,
        "completion": "true",
        "fuzzy": "true",
    }
    resp = await client.get(f"{DB_API_BASE}/stations", params=params, timeout=10.0)
    resp.raise_for_status()
    data = resp.json()
    if not data:
        raise HTTPException(status_code=404, detail=f"Kein Bahnhof gefunden für '{station_query}'.")

    station_id, station_data = next(iter(data.items()))
    return StationInfo(
        id=str(station_id),
        name=station_data.get("name", station_query),
    )


async def fetch_departures(
    client: httpx.AsyncClient,
    station_id: str,
    when: Optional[str],
    duration: int,
    max_results: int = 200,
) -> List[Dict[str, Any]]:
    """
    Holt Abfahrten an einem Bahnhof, gefiltert auf RE/RB/S-Bahn (Regionalzug-Sachen).
    """
    params = {
        "duration": str(duration),
        "results": str(max_results),
        "language": "de",
        "nationalExpress": "false",
        "national": "false",
        "regionalExpress": "true",
        "regional": "true",
        "suburban": "true",
        "bus": "false",
        "ferry": "false",
        "subway": "false",
        "tram": "false",
        "taxi": "false",
    }
    if when:
        params["when"] = when

    resp = await client.get(
        f"{DB_API_BASE}/stops/{station_id}/departures",
        params=params,
        timeout=20.0,
    )
    resp.raise_for_status()
    data = resp.json()
    if not isinstance(data, list):
        return []
    return data


async def fetch_trip(
    client: httpx.AsyncClient,
    trip_id: str,
) -> Optional[Dict[str, Any]]:
    """
    Holt einen Trip mit allen Stopovers.
    """
    params = {
        "stopovers": "true",
        "remarks": "false",
        "polyline": "false",
        "language": "de",
    }
    resp = await client.get(
        f"{DB_API_BASE}/trips/{trip_id}",
        params=params,
        timeout=20.0,
    )
    if resp.status_code != 200:
        return None
    return resp.json()


def parse_iso(dt_str: Optional[str]) -> Optional[datetime]:
    if not dt_str:
        return None
    try:
        return datetime.fromisoformat(dt_str)
    except Exception:
        return None


@app.get("/longest-direct", response_model=List[DirectConnection])
async def longest_direct(
    station: str = Query(..., description="Name des Startbahnhofs, z. B. 'Koblenz Hbf'"),
    limit: int = Query(10, ge=1, le=50, description="Anzahl der Verbindungen"),
    duration: int = Query(
        240,
        ge=30,
        le=720,
        description="Suchfenster in Minuten ab 'when' (oder jetzt), in dem Abfahrten geprüft werden.",
    ),
    when: Optional[str] = Query(
        None,
        description="Optionale Startzeit (ISO-8601, z. B. 2025-11-29T08:00:00+01:00).",
    ),
):
    """
    Findet die längsten durchgehenden Regionalzug-Verbindungen (RE/RB/S) ab einem Bahnhof,
    ohne Umstieg – basierend auf den Trips, die im angegebenen Zeitfenster abfahren.
    """
    async with httpx.AsyncClient() as client:
        origin_station = await resolve_station_id(client, station)

        departures = await fetch_departures(client, origin_station.id, when, duration)
        if not departures:
            raise HTTPException(
                status_code=404,
                detail=f"Keine Abfahrten im angegebenen Zeitfenster für '{origin_station.name}'.",
            )

        connections: Dict[str, DirectConnection] = {}
        max_departures_to_check = min(len(departures), 80)

        for dep in departures[:max_departures_to_check]:
            trip_id = dep.get("tripId")
            line = dep.get("line") or {}
            if not trip_id or not line:
                continue

            line_name = line.get("name") or "Unbekannt"
            product = line.get("product") or line.get("mode") or "regional"
            direction = dep.get("direction") or ""

            trip = await fetch_trip(client, trip_id)
            if not trip:
                continue

            stopovers = trip.get("stopovers") or []
            if not stopovers:
                continue

            origin_index = None
            for idx, st in enumerate(stopovers):
                stop = st.get("stop") or {}
                if str(stop.get("id")) == origin_station.id:
                    origin_index = idx
                    break

            if origin_index is None:
                continue

            if origin_index >= len(stopovers) - 1:
                continue

            last_stop = stopovers[-1]
            last_stop_data = last_stop.get("stop") or {}
            to_station = StationInfo(
                id=str(last_stop_data.get("id")),
                name=last_stop_data.get("name", "Unbekannt"),
            )

            origin_stop = stopovers[origin_index]
            dep_time_str = origin_stop.get("departure") or origin_stop.get("plannedDeparture")
            arr_time_str = last_stop.get("arrival") or last_stop.get("plannedArrival")
            dep_dt = parse_iso(dep_time_str)
            arr_dt = parse_iso(arr_time_str)
            if not dep_dt or not arr_dt:
                continue

            duration_minutes = int((arr_dt - dep_dt).total_seconds() // 60)
            if duration_minutes <= 0:
                continue

            stops_after_origin = len(stopovers) - origin_index - 1

            key = f"{line_name}|{direction}|{to_station.id}"

            existing = connections.get(key)
            if existing is None or duration_minutes > existing.duration_minutes:
                connections[key] = DirectConnection(
                    line_name=line_name,
                    product=product,
                    direction=direction,
                    from_station=origin_station,
                    to_station=to_station,
                    departure=dep_dt,
                    arrival=arr_dt,
                    duration_minutes=duration_minutes,
                    stops_after_origin=stops_after_origin,
                    trip_id=trip_id,
                )

        if not connections:
            raise HTTPException(
                status_code=404,
                detail=(
                    "Es konnten keine durchgehenden Regionalzug-Verbindungen mit "
                    "berechenbarer Dauer gefunden werden."
                ),
            )

        sorted_connections = sorted(
            connections.values(), key=lambda c: c.duration_minutes, reverse=True
        )

        return sorted_connections[:limit]
