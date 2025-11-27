const API_BASE = getApiBase();
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
  const url = new URL(`${API_BASE}/longest-direct`);
  url.searchParams.set("station", station);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("duration", String(duration));
  if (when) url.searchParams.set("when", when);

  const resp = await fetch(url, { headers: { accept: "application/json" } });
  if (!resp.ok) {
    const detail = await safeError(resp);
    throw new Error(detail || `Backend-Fehler (${resp.status}).`);
  }

  const data = await resp.json();
  if (!Array.isArray(data)) {
    throw new Error("Antwort konnte nicht gelesen werden.");
  }

  return data.map(mapApiConnection);
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

function safeError(resp) {
  return resp
    .json()
    .then((data) => data?.detail || data?.message)
    .catch(() => null);
}

function mapApiConnection(raw) {
  return {
    lineName: raw.line_name,
    product: raw.product,
    direction: raw.direction,
    fromStation: raw.from_station,
    toStation: raw.to_station,
    departure: raw.departure,
    arrival: raw.arrival,
    durationMinutes: raw.duration_minutes,
    stopsAfterOrigin: raw.stops_after_origin,
    tripId: raw.trip_id,
  };
}

function getApiBase() {
  const urlOverride = new URLSearchParams(window.location.search).get("apiBase");
  if (urlOverride) return urlOverride.replace(/\/$/, "");

  if (window.WNT_DB_API_BASE) return String(window.WNT_DB_API_BASE).replace(/\/$/, "");

  if (window.location.hostname.endsWith("github.io")) {
    return "https://wnt-db.fly.dev";
  }

  return "http://localhost:8000";
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
