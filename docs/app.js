const DB_API_BASE = "https://v6.db.transport.rest";
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const form = document.getElementById("search-form");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(form);
  const station = formData.get("station")?.toString().trim();
  const limit = Number(formData.get("limit") || 10);
  const duration = Number(formData.get("duration") || 240);
  const when = formData.get("when")?.toString().trim() || undefined;

  if (!station) {
    setStatus("Bitte Startbahnhof eingeben.", "warn");
    return;
  }

  form.querySelector("button")?.setAttribute("disabled", "true");
  setStatus("Suche läuft …", "info");
  resultsEl.innerHTML = "";

  try {
    const connections = await findLongestDirect({ station, limit, duration, when });
    renderResults(connections);
    setStatus(`${connections.length} Verbindungen gefunden.`);
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Fehler bei der Suche.", "warn");
  } finally {
    form.querySelector("button")?.removeAttribute("disabled");
  }
});

async function findLongestDirect({ station, limit, duration, when }) {
  const stationInfo = await resolveStationId(station);
  const departures = await fetchDepartures(stationInfo.id, { duration, when });

  if (!departures.length) {
    throw new Error(`Keine Abfahrten im Zeitfenster für "${stationInfo.name}".`);
  }

  const maxDeparturesToCheck = Math.min(departures.length, 80);
  const connections = new Map();

  for (const dep of departures.slice(0, maxDeparturesToCheck)) {
    const tripId = dep.tripId;
    const line = dep.line || {};
    if (!tripId || !Object.keys(line).length) continue;

    const lineName = line.name || "Unbekannt";
    const product = line.product || line.mode || "regional";
    const direction = dep.direction || "";

    const trip = await fetchTrip(tripId);
    if (!trip) continue;

    const stopovers = trip.stopovers || [];
    if (!stopovers.length) continue;

    const originIndex = stopovers.findIndex((s) => String(s.stop?.id) === String(stationInfo.id));
    if (originIndex < 0 || originIndex >= stopovers.length - 1) continue;

    const lastStop = stopovers[stopovers.length - 1];
    const toStation = {
      id: String(lastStop.stop?.id),
      name: lastStop.stop?.name || "Unbekannt",
    };

    const originStop = stopovers[originIndex];
    const depTimeStr = originStop.departure || originStop.plannedDeparture;
    const arrTimeStr = lastStop.arrival || lastStop.plannedArrival;
    const depTime = depTimeStr ? new Date(depTimeStr) : null;
    const arrTime = arrTimeStr ? new Date(arrTimeStr) : null;
    if (!depTime || !arrTime || isNaN(depTime) || isNaN(arrTime)) continue;

    const durationMinutes = Math.floor((arrTime - depTime) / 60000);
    if (durationMinutes <= 0) continue;

    const stopsAfterOrigin = stopovers.length - originIndex - 1;
    const key = `${lineName}|${direction}|${toStation.id}`;
    const existing = connections.get(key);

    if (!existing || durationMinutes > existing.durationMinutes) {
      connections.set(key, {
        lineName,
        product,
        direction,
        fromStation: stationInfo,
        toStation,
        departure: depTime,
        arrival: arrTime,
        durationMinutes,
        stopsAfterOrigin,
        tripId,
      });
    }
  }

  if (!connections.size) {
    throw new Error("Keine durchgehenden Regionalzug-Verbindungen mit berechenbarer Dauer gefunden.");
  }

  return Array.from(connections.values())
    .sort((a, b) => b.durationMinutes - a.durationMinutes)
    .slice(0, limit);
}

async function resolveStationId(query) {
  const url = new URL(`${DB_API_BASE}/stations`);
  url.searchParams.set("query", query);
  url.searchParams.set("limit", "1");
  url.searchParams.set("completion", "true");
  url.searchParams.set("fuzzy", "true");

  const resp = await fetch(url, { headers: { accept: "application/json" } });
  if (!resp.ok) throw new Error(`Stationssuche fehlgeschlagen (${resp.status}).`);
  const data = await resp.json();
  const entry = Object.entries(data)[0];
  if (!entry) throw new Error(`Kein Bahnhof gefunden für "${query}".`);
  const [id, info] = entry;
  return { id: String(id), name: info.name || query };
}

async function fetchDepartures(stationId, { duration, when }) {
  const url = new URL(`${DB_API_BASE}/stops/${stationId}/departures`);
  url.searchParams.set("duration", String(duration));
  url.searchParams.set("results", "200");
  url.searchParams.set("language", "de");
  url.searchParams.set("nationalExpress", "false");
  url.searchParams.set("national", "false");
  url.searchParams.set("regionalExpress", "true");
  url.searchParams.set("regional", "true");
  url.searchParams.set("suburban", "true");
  url.searchParams.set("bus", "false");
  url.searchParams.set("ferry", "false");
  url.searchParams.set("subway", "false");
  url.searchParams.set("tram", "false");
  url.searchParams.set("taxi", "false");
  if (when) url.searchParams.set("when", when);

  const resp = await fetch(url, { headers: { accept: "application/json" } });
  if (!resp.ok) throw new Error(`Abfahrten konnten nicht geladen werden (${resp.status}).`);
  const data = await resp.json();
  return Array.isArray(data) ? data : [];
}

async function fetchTrip(tripId) {
  const url = new URL(`${DB_API_BASE}/trips/${encodeURIComponent(tripId)}`);
  url.searchParams.set("stopovers", "true");
  url.searchParams.set("remarks", "false");
  url.searchParams.set("polyline", "false");
  url.searchParams.set("language", "de");
  const resp = await fetch(url, { headers: { accept: "application/json" } });
  if (!resp.ok) return null;
  return resp.json();
}

function renderResults(connections) {
  if (!connections.length) {
    resultsEl.innerHTML = "<p class=\"small\">Keine Treffer.</p>";
    return;
  }

  const rows = connections
    .map(
      (c) => `
        <tr>
          <td><strong>${escapeHtml(c.lineName)}</strong> (${escapeHtml(c.product)})</td>
          <td>${escapeHtml(c.fromStation.name)} → ${escapeHtml(c.toStation.name)}</td>
          <td>${minutesToHhMm(c.durationMinutes)}</td>
          <td>${escapeHtml(c.direction || "–")}</td>
          <td>${c.stopsAfterOrigin}</td>
          <td class="code">${escapeHtml(c.tripId)}</td>
        </tr>
      `
    )
    .join("");

  resultsEl.innerHTML = `
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Linie</th>
            <th>Von → Nach</th>
            <th>Dauer</th>
            <th>Richtung</th>
            <th>Stopps</th>
            <th>Trip ID</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function setStatus(text, tone = "info") {
  statusEl.textContent = text;
  statusEl.dataset.tone = tone;
}

function minutesToHhMm(minutes) {
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hrs}h ${String(mins).padStart(2, "0")}m`;
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
