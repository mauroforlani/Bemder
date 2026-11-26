// Cime e rifugi di una zona, ordinati per notorietà, con i sentieri che ci arrivano
// e i link per studiare l'itinerario su altri siti.
import { overpass, overpassRace, fetchJSON } from './api.js';
import { addFame, fameScore } from './fame.js';
import { haversine, toMerc } from './geo.js';

/* ---------- Suggerimenti mentre scrivi (Photon, basato su OpenStreetMap) ---------- */
export async function suggest(q, signal) {
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=7&lat=46.3&lon=11.0`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const seen = new Set();
  const out = [];
  for (const f of data.features || []) {
    const p = f.properties || {};
    if (!p.name || !f.geometry?.coordinates) continue;
    const sub = [p.city !== p.name && p.city, p.county, p.state, p.country].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
    const key = `${p.name}|${sub}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const [lon, lat] = f.geometry.coordinates;
    out.push({ name: p.name, sub, lat, lon, kind: p.osm_value });
  }
  return out;
}

/* ---------- Cime e rifugi ---------- */
const HUT_TYPE = { alpine_hut: 'Rifugio', wilderness_hut: 'Bivacco' };

export async function explore(center, radiusKm, status = () => {}) {
  const r = Math.round(radiusKm * 1000);
  status('Cerco cime e rifugi su OpenStreetMap…');
  const q = `[out:json][timeout:90];
(
  node["natural"="peak"]["name"](around:${r},${center.lat},${center.lon});
  nwr["tourism"~"^(alpine_hut|wilderness_hut)$"](around:${r},${center.lat},${center.lon});
);
out center tags;`;
  const data = await overpass(q, 100000);
  const c0 = [center.lat, center.lon];
  const items = [];
  for (const el of data.elements || []) {
    const t = el.tags || {};
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null) continue;
    const isPeak = t.natural === 'peak';
    const name = t['name:it'] || t.name || (isPeak ? null : HUT_TYPE[t.tourism]);
    if (!name) continue;
    items.push({
      id: `${el.type}/${el.id}`,
      kind: isPeak ? 'peak' : 'hut',
      type: isPeak ? 'Cima' : HUT_TYPE[t.tourism],
      name,
      unnamed: !(t['name:it'] || t.name),
      ele: t.ele ? Math.round(parseFloat(String(t.ele).replace(',', '.'))) || null : null,
      lat, lon,
      dist: haversine(c0, [lat, lon]),
      website: t.website || t['contact:website'] || null,
      phone: t.phone || t['contact:phone'] || null,
      hours: t.opening_hours || null,
      beds: t.beds || t.capacity || null,
      operator: t.operator || null,
      tags: { wikidata: t.wikidata, wikipedia: t.wikipedia },
    });
  }
  if (!items.length) return { peaks: [], huts: [] };

  status(`Valuto quali delle ${items.length} cime e rifugi sono i più conosciuti…`);
  // prima rifugi e cime più alte: se il limite taglia, taglia le cimette minori
  const order = items.slice().sort((a, b) => (a.kind === 'hut' ? -1 : 0) - (b.kind === 'hut' ? -1 : 0) || (b.ele || 0) - (a.ele || 0));
  try { await addFame(order, 500); } catch (e) { console.warn(e); }

  for (const x of items) {
    x.fame = fameScore(x);
    x.score = x.kind === 'peak'
      ? x.fame * 1.2 + ((x.ele || 0) / 1000) * 0.5
      : x.fame * 1.2 + (x.type === 'Rifugio' ? 1 : 0.3) + (x.website ? 0.4 : 0) + ((x.ele || 0) / 1000) * 0.2 - (x.unnamed ? 1.5 : 0);
    delete x.tags;
  }
  const byScore = (a, b) => b.score - a.score;
  return {
    peaks: items.filter((x) => x.kind === 'peak').sort(byScore),
    huts: items.filter((x) => x.kind === 'hut').sort(byScore),
  };
}

export const TRAIL_RADIUS = 300;
/** Sentieri segnati (relazioni route=hiking di OSM, rete CAI compresa) che passano entro 300 m dal punto. */
export async function trailsTo(p) {
  const q = `[out:json][timeout:15];relation["route"="hiking"](around:${TRAIL_RADIUS},${p.lat},${p.lon});out tags;`;
  const data = await overpassRace(q, 15000);
  return (data.elements || [])
    .map((el) => {
      const t = el.tags || {};
      return { id: el.id, ref: t.ref, name: t.name, from: t.from, to: t.to, diff: t.cai_scale || null };
    })
    .sort((a, b) => (a.ref || 'zzz').localeCompare(b.ref || 'zzz', 'it', { numeric: true }));
}

/* ---------- Link per capire l'itinerario ---------- */
// DuckDuckGo con "\" apre direttamente il primo risultato: si arriva subito sulla pagina del sito.
const direct = (domain, q) => `https://duckduckgo.com/?q=${encodeURIComponent(`\\site:${domain} ${q}`)}`;
function c2cBbox(lat, lon, km) {
  const [x, y] = toMerc(lat, lon);
  const k = (km * 1000) / Math.cos((lat * Math.PI) / 180);
  return [x - k, y - k, x + k, y + k].map(Math.round).join(',');
}
const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const STOP = new Set(['monte', 'cima', 'punta', 'pizzo', 'rifugio', 'bivacco', 'capanna', 'di', 'del', 'della', 'dei', 'delle', 'la', 'il', 'lo', 'le', 'al', 'alla', 'piz', 'sasso', 'col', 'croda', 'passo', 'hutte', 'huette', 'rif']);

/** Pagina Camptocamp della cima/rifugio (con l'elenco degli itinerari che ci arrivano), se esiste. */
export async function c2cPage(p) {
  const wtyp = p.kind === 'peak' ? 'summit' : 'hut,shelter,bivouac,gite';
  const d = await fetchJSON(`https://api.camptocamp.org/waypoints?bbox=${c2cBbox(p.lat, p.lon, 0.8)}&wtyp=${wtyp}&limit=30&pl=it`, { timeout: 15000 });
  const words = norm(p.name).split(' ').filter((w) => w.length > 2 && !STOP.has(w));
  let best = null;
  for (const doc of d.documents || []) {
    let pos = null;
    try {
      const g = JSON.parse(doc.geometry?.geom || 'null');
      if (g?.type === 'Point') {
        const [x, y] = g.coordinates;
        pos = [((2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2) * 180) / Math.PI, (x / 6378137) * (180 / Math.PI)];
      }
    } catch { /* senza geometria */ }
    if (!pos) continue;
    const dist = haversine([p.lat, p.lon], pos);
    const titles = (doc.locales || []).map((l) => norm(l.title)).join(' ');
    const match = words.length ? words.filter((w) => titles.includes(w)).length / words.length : 0;
    // stesso nome (anche in parte) e vicino, oppure praticamente nello stesso punto
    const score = match * 2 - dist / 800;
    if ((match >= 0.5 && dist < 1500) || dist < 150) {
      if (!best || score > best.score) best = { score, id: doc.document_id };
    }
  }
  return best ? `https://www.camptocamp.org/waypoints/${best.id}` : null;
}

export function links(p) {
  const out = [];
  if (p.kind === 'hut' && p.website) out.push({ id: 'site', name: 'Sito del rifugio', url: p.website });
  out.push(
    { id: 'gulliver', name: 'Gulliver', url: direct('gulliver.it', p.name), note: 'relazioni degli utenti' },
    { id: 'c2c', name: 'Camptocamp', url: `https://www.camptocamp.org/routes?bbox=${c2cBbox(p.lat, p.lon, 1.5)}`, note: 'itinerari qui vicino' },
    { id: 'hikr', name: 'Hikr', url: direct('hikr.org', p.name), note: 'report con foto' },
  );
  if (p.kind === 'peak') out.push({ id: 'vienormali', name: 'Vienormali', url: direct('vienormali.it', p.name), note: 'via normale' });
  out.push({ id: 'wikiloc', name: 'Wikiloc', url: direct('wikiloc.com', p.name), note: 'tracce GPS' });
  if (p.wikiUrl) out.push({ id: 'wiki', name: 'Wikipedia', url: p.wikiUrl });
  out.push({ id: 'map', name: 'Mappa sentieri', url: `https://opentopomap.org/#map=15/${p.lat.toFixed(5)}/${p.lon.toFixed(5)}`, note: 'OpenTopoMap' });
  return out;
}

export const trailLink = (id) => `https://hiking.waymarkedtrails.org/#route?id=${id}`;
