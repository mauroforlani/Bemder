// Accesso alle fonti dati pubbliche (tutte gratuite, senza chiave, con CORS abilitato).
//  - Nominatim (OpenStreetMap): geocodifica
//  - Overpass API (OpenStreetMap): sentieri, vie ferrate, percorsi invernali, rifugi, cime
//  - Open-Meteo: previsioni meteo in quota e altimetria
//  (Camptocamp è in c2c.js)

const mem = new Map();

function ssGet(k) {
  try {
    const v = sessionStorage.getItem(k);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}
function ssSet(k, v) {
  try {
    sessionStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* quota piena: si usa solo la cache in memoria */
  }
}

export async function fetchJSON(url, { method = 'GET', body, headers, timeout = 30000, cache = true } = {}) {
  const key = 'c:' + method + ':' + url + ':' + (body || '');
  if (cache) {
    if (mem.has(key)) return mem.get(key);
    const s = ssGet(key);
    if (s) {
      mem.set(key, s);
      return s;
    }
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { method, body, headers, signal: ctrl.signal });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    if (cache) {
      mem.set(key, data);
      ssSet(key, data);
    }
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw Object.assign(new Error('tempo scaduto'), { status: 0 });
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export function clearCache() {
  mem.clear();
  try {
    Object.keys(sessionStorage).filter((k) => k.startsWith('c:')).forEach((k) => sessionStorage.removeItem(k));
  } catch { /* ignore */ }
}

/* ---------- Nominatim ---------- */
export async function geocode(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=it&q=${encodeURIComponent(q)}`;
  const data = await fetchJSON(url);
  return data.map((d) => ({
    name: d.display_name,
    short: d.name || d.display_name.split(',')[0],
    lat: +d.lat,
    lon: +d.lon,
    bbox: [+d.boundingbox[0], +d.boundingbox[2], +d.boundingbox[1], +d.boundingbox[3]], // s, w, n, e
    type: d.type,
    cls: d.category || d.class,
  }));
}

export async function reverseGeocode(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=12&accept-language=it&lat=${lat}&lon=${lon}`;
  try {
    const d = await fetchJSON(url);
    return d.name || d.display_name?.split(',')[0] || `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
  } catch {
    return `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
  }
}

/* ---------- Overpass ---------- */
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

export async function overpass(query, timeout = 100000) {
  let lastErr;
  for (const ep of OVERPASS) {
    try {
      const data = await fetchJSON(ep, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        timeout,
      });
      if (data.remark && /error|timed out/i.test(data.remark) && !(data.elements || []).length) {
        throw new Error(data.remark);
      }
      return data;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`OpenStreetMap (Overpass) non risponde: ${lastErr?.message || 'errore'}. Riprova tra un minuto o riduci l'area.`);
}

/** Per richieste piccole: interroga tutti i server insieme e usa la prima risposta valida. */
export async function overpassRace(query, timeout = 15000) {
  const one = (ep) => fetchJSON(ep, {
    method: 'POST',
    body: 'data=' + encodeURIComponent(query),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    timeout,
  }).then((d) => {
    if (d.remark && /error|timed out/i.test(d.remark)) throw new Error(d.remark);
    return d;
  });
  try {
    return await Promise.any(OVERPASS.map(one));
  } catch {
    throw new Error('OpenStreetMap non ha risposto in tempo');
  }
}

/* ---------- Open-Meteo ---------- */
export function isoDate(d) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
export function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return isoDate(d);
}
/** Le previsioni Open-Meteo coprono oggi + 15 giorni. */
export function forecastWindow(startIso, days) {
  const today = isoDate(new Date());
  const last = addDays(today, 15);
  const end = addDays(startIso, days - 1);
  if (end < today || startIso > last) return null;
  return { start: startIso < today ? today : startIso, end: end > last ? last : end };
}

export async function forecast(lat, lon, start, end, { elevation, hourly } = {}) {
  let url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max` +
    `&timezone=auto&start_date=${start}&end_date=${end}`;
  if (elevation != null) url += `&elevation=${Math.round(elevation)}`;
  if (hourly) url += '&hourly=freezing_level_height';
  const d = await fetchJSON(url, { cache: false });
  const days = {};
  (d.daily?.time || []).forEach((t, i) => {
    days[t] = {
      code: d.daily.weather_code[i],
      tmax: d.daily.temperature_2m_max[i],
      tmin: d.daily.temperature_2m_min[i],
      rainProb: d.daily.precipitation_probability_max[i],
      rain: d.daily.precipitation_sum[i],
      wind: d.daily.wind_speed_10m_max[i],
    };
  });
  if (hourly && d.hourly?.time) {
    d.hourly.time.forEach((t, i) => {
      const day = t.slice(0, 10);
      const hr = +t.slice(11, 13);
      const v = d.hourly.freezing_level_height[i];
      if (days[day] && hr >= 8 && hr <= 18 && v != null) {
        days[day].freezeMin = Math.min(days[day].freezeMin ?? Infinity, v);
        days[day].freezeMax = Math.max(days[day].freezeMax ?? -Infinity, v);
      }
    });
  }
  return days;
}

/** Quote (modello Copernicus 90 m) per una lista di punti [lat,lon]; max 100 per richiesta. */
export async function elevations(points) {
  const res = [];
  for (let i = 0; i < points.length; i += 100) {
    const chunk = points.slice(i, i + 100);
    const lat = chunk.map((p) => p[0].toFixed(5)).join(',');
    const lon = chunk.map((p) => p[1].toFixed(5)).join(',');
    const d = await fetchJSON(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`);
    res.push(...d.elevation);
  }
  return res;
}

export const WMO = {
  0: ['☀️', 'Sereno'], 1: ['🌤️', 'Prevalentemente sereno'], 2: ['⛅', 'Parzialmente nuvoloso'], 3: ['☁️', 'Coperto'],
  45: ['🌫️', 'Nebbia'], 48: ['🌫️', 'Nebbia con brina'],
  51: ['🌦️', 'Pioviggine debole'], 53: ['🌦️', 'Pioviggine'], 55: ['🌧️', 'Pioviggine intensa'],
  56: ['🌧️', 'Pioviggine gelata'], 57: ['🌧️', 'Pioviggine gelata'],
  61: ['🌦️', 'Pioggia debole'], 63: ['🌧️', 'Pioggia'], 65: ['🌧️', 'Pioggia forte'],
  66: ['🌧️', 'Pioggia gelata'], 67: ['🌧️', 'Pioggia gelata forte'],
  71: ['🌨️', 'Neve debole'], 73: ['🌨️', 'Neve'], 75: ['❄️', 'Neve forte'], 77: ['🌨️', 'Granuli di neve'],
  80: ['🌦️', 'Rovesci'], 81: ['🌧️', 'Rovesci'], 82: ['⛈️', 'Rovesci violenti'],
  85: ['🌨️', 'Rovesci di neve'], 86: ['❄️', 'Rovesci di neve forti'],
  95: ['⛈️', 'Temporale'], 96: ['⛈️', 'Temporale con grandine'], 99: ['⛈️', 'Temporale con grandine'],
};
