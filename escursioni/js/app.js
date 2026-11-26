import { suggest, explore, trailsTo, links, trailLink, c2cPage, TRAIL_RADIUS } from './places.js';
import { geocode, reverseGeocode } from './api.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const km = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);
const views = (v) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : String(v));
const ext = (url, html) => `<a href="${esc(url)}" target="_blank" rel="noopener">${html}</a>`;

const PAGE = 15;
const state = { zone: null, radius: 15, data: null, tab: 'peaks', shown: PAGE, open: null };

/* ---------------- Mappa ---------------- */
let map = null;
let layer = null;
const markers = new Map();
function initMap() {
  if (!window.L) {
    $('#map').innerHTML = '<p class="maperr">Mappa non disponibile (libreria Leaflet non caricata).</p>';
    return;
  }
  map = L.map('map').setView([46.2, 10.8], 7);
  const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: '© OpenStreetMap contributors, SRTM | © OpenTopoMap (CC-BY-SA)' });
  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' });
  topo.addTo(map);
  L.control.layers({ Topografica: topo, Stradale: osm }).addTo(map);
  L.control.scale({ imperial: false }).addTo(map);
  layer = L.layerGroup().addTo(map);
}
const icon = (p, rank) => L.divIcon({
  className: '',
  html: `<div class="pin" style="background:${p.kind === 'peak' ? '#7c3a12' : '#4d7c0f'}">${rank ?? (p.kind === 'peak' ? '▲' : '⌂')}</div>`,
  iconSize: [26, 26], iconAnchor: [13, 13],
});

function drawMap() {
  if (!map) return;
  layer.clearLayers();
  markers.clear();
  const { zone, data } = state;
  L.circle([zone.lat, zone.lon], { radius: state.radius * 1000, color: '#4d7c0f', weight: 1, fillOpacity: 0.03 }).addTo(layer);
  const list = (state.tab === 'peaks' ? data.peaks : data.huts).slice(0, state.shown);
  list.forEach((p, i) => {
    const m = L.marker([p.lat, p.lon], { icon: icon(p, i + 1), title: p.name })
      .bindPopup(`<b>${esc(p.name)}</b>${p.ele ? ` · ${p.ele} m` : ''}<br>${esc(p.type)}`)
      .on('click', () => openPlace(p.id, true))
      .addTo(layer);
    markers.set(p.id, m);
  });
  const pts = list.map((p) => [p.lat, p.lon]);
  if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 14, animate: false });
  else map.setView([zone.lat, zone.lon], 12);
  setTimeout(() => map.invalidateSize(), 50);
}

/* ---------------- Stato e messaggi ---------------- */
function status(msg, kind = 'busy') {
  const el = $('#status');
  if (!msg) { el.hidden = true; return; }
  el.hidden = false;
  el.className = 'status' + (kind === 'error' ? ' error' : '');
  el.innerHTML = (kind === 'busy' ? '<span class="spin"></span>' : '') + `<span>${esc(msg)}</span>`;
}

/* ---------------- Ricerca della zona ---------------- */
async function run(zone, radius = +$('#radius').value || 15) {
  state.zone = zone;
  state.radius = radius;
  $('#radius').value = String(radius);
  state.shown = PAGE;
  state.open = null;
  $('#results').innerHTML = '';
  $('#zone').value = zone.name;
  history.replaceState(null, '', `#zona=${zone.lat.toFixed(5)},${zone.lon.toFixed(5)},${radius},${encodeURIComponent(zone.name)}`);
  try {
    const data = await explore(zone, radius, (m) => status(m));
    status(null);
    state.data = data;
    if (!data.peaks.length && !data.huts.length) {
      $('#results').innerHTML = `<div class="warn">Nessuna cima o rifugio entro ${radius} km da ${esc(zone.name)}: aumenta la distanza.</div>`;
      return;
    }
    state.tab = data.peaks.length ? 'peaks' : 'huts';
    render();
  } catch (e) {
    console.error(e);
    status(`${e.message || e}`, 'error');
  }
}

function placeHtml(p, i) {
  const pop = p.views ? `<span class="pop" title="Visite alla pagina Wikipedia nell'ultimo mese">★ ${views(p.views)}/mese</span>` : '';
  return `<div class="place" data-id="${esc(p.id)}">
    <div class="ph"><span class="rank">${i + 1}</span>
      <span class="nm"><b>${esc(p.name)}</b><small>${esc(p.type)}${p.ele ? ` · ${p.ele} m` : ''} · a ${km(p.dist)}</small></span>${pop}</div>
    <div class="pb" hidden></div>
  </div>`;
}

function render() {
  const { data, tab, zone } = state;
  const list = tab === 'peaks' ? data.peaks : data.huts;
  $('#results').innerHTML = `
    <div class="res-head"><h2>${esc(zone.name)}</h2>
      <div class="muted">entro ${state.radius} km · ordinati per notorietà (visite su Wikipedia), poi per quota</div></div>
    <div class="seg">
      <button data-tab="peaks" class="${tab === 'peaks' ? 'on' : ''}">🏔️ Cime (${data.peaks.length})</button>
      <button data-tab="huts" class="${tab === 'huts' ? 'on' : ''}">🏠 Rifugi e bivacchi (${data.huts.length})</button>
    </div>
    <div id="list">${list.slice(0, state.shown).map(placeHtml).join('')}</div>
    ${list.length > state.shown ? `<button class="more" id="more">Mostra altri (${list.length - state.shown})</button>` : ''}
    <div class="actions"><button class="small" id="share">🔗 Copia link a questa zona</button></div>`;
  $$('.seg button').forEach((b) => b.addEventListener('click', () => {
    state.tab = b.dataset.tab;
    state.shown = PAGE;
    state.open = null;
    render();
  }));
  $('#more')?.addEventListener('click', () => { state.shown += PAGE; render(); });
  $('#share').addEventListener('click', async (e) => {
    try { await navigator.clipboard.writeText(location.href); e.target.textContent = '✓ Copiato'; } catch { prompt('Copia il link:', location.href); }
  });
  $$('.place .ph').forEach((h) => h.addEventListener('click', () => openPlace(h.parentElement.dataset.id)));
  drawMap();
}

async function openPlace(id, fromMap = false) {
  const card = $(`.place[data-id="${CSS.escape(id)}"]`);
  if (!card) return;
  const body = $('.pb', card);
  if (state.open === id && !fromMap) {
    card.classList.remove('open');
    body.hidden = true;
    state.open = null;
    return;
  }
  $$('.place.open').forEach((c) => { c.classList.remove('open'); $('.pb', c).hidden = true; });
  state.open = id;
  card.classList.add('open');
  body.hidden = false;
  if (fromMap) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  const p = [...state.data.peaks, ...state.data.huts].find((x) => x.id === id);
  if (map) {
    map.setView([p.lat, p.lon], Math.max(map.getZoom(), 14), { animate: false });
    markers.get(id)?.openPopup();
  }
  const info = p.kind === 'hut'
    ? `<p>${[p.operator && esc(p.operator), p.beds && `${esc(p.beds)} posti`, p.hours && `🕘 ${esc(p.hours)}`, p.phone && `☎️ <a href="tel:${esc(p.phone)}">${esc(p.phone)}</a>`].filter(Boolean).join(' · ') || '<span class="muted">Contatti e stagione di apertura non indicati: verifica prima di partire.</span>'}</p>`
    : '';
  body.innerHTML = `${info}
    <h4>📖 Come arrivarci: relazioni e itinerari</h4>
    <ul class="linklist">${links(p).map((l) => `<li data-link="${l.id}">${ext(l.url, `${esc(l.name)} ↗${l.note ? ` <small>· ${esc(l.note)}</small>` : ''}`)}</li>`).join('')}</ul>
    <h4>🥾 Sentieri segnati che ci passano</h4>
    <div class="trails"></div>`;
  // Camptocamp: se esiste, collega direttamente la pagina della cima/rifugio (in parallelo ai sentieri)
  (async () => {
    if (p.c2c === undefined) {
      try { p.c2c = await c2cPage(p); } catch { p.c2c = null; }
    }
    const li = $('[data-link="c2c"]', body);
    if (p.c2c && li && state.open === id) li.innerHTML = ext(p.c2c, 'Camptocamp ↗ <small>· pagina con tutti gli itinerari</small>');
  })();
  loadTrails(p, body, id);
}

async function loadTrails(p, body, id) {
  const tEl = $('.trails', body);
  if (!p.trails) {
    tEl.innerHTML = `<span class="muted"><span class="spin small"></span> Chiedo a OpenStreetMap quali sentieri numerati passano entro ${TRAIL_RADIUS} m…</span>`;
    try { p.trails = await trailsTo(p); } catch { p.trails = null; }
  }
  if (state.open !== id) return;
  if (p.trails == null) {
    tEl.innerHTML = '<span class="muted">OpenStreetMap non ha risposto in tempo (i server pubblici a volte sono carichi).</span> <button class="small" type="button">↻ Riprova</button>';
    $('button', tEl).addEventListener('click', () => loadTrails(p, body, id));
  } else if (!p.trails.length) {
    tEl.innerHTML = `<span class="muted">Nessun sentiero numerato passa entro ${TRAIL_RADIUS} m. ${p.kind === 'peak' ? 'Capita spesso per le cime: il sentiero arriva a un passo o a una forcella e l\'ultimo tratto è su traccia o via alpinistica.' : 'Il rifugio potrebbe essere raggiunto da strada o sentiero non mappato come percorso.'} Usa i link qui sopra.</span>`;
  } else {
    tEl.innerHTML = p.trails.map((t) => `<div class="trail">${ext(trailLink(t.id), `<b>${t.ref ? `Sentiero ${esc(t.ref)}` : esc(t.name || 'Sentiero')}</b>`)}${t.diff ? ` <span class="badge">${esc(t.diff)}</span>` : ''}
      <div class="muted">${esc([t.from, t.to].filter(Boolean).join(' → ') || (t.name && t.name !== `Sentiero ${t.ref}` && t.ref ? t.name : ''))}</div></div>`).join('') +
      '<p class="muted">Ogni link apre il tracciato su Waymarked Trails, con percorso sulla mappa e profilo.</p>';
  }
}

/* ---------------- Campo zona con suggerimenti + pulsante Cerca ---------------- */
let chosen = null; // località scelta dall'elenco (o dalla posizione), in attesa di "Cerca"

function initCombo() {
  const input = $('#zone');
  const list = $('#sugg');
  let items = [];
  let active = -1;
  let timer = null;
  let ctrl = null;

  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; };
  const paint = () => {
    list.innerHTML = items.map((s, i) => `<li role="option" data-i="${i}" class="${i === active ? 'on' : ''}"><b>${esc(s.name)}</b>${s.sub ? `<small>${esc(s.sub)}</small>` : ''}</li>`).join('');
    list.hidden = !items.length;
    input.setAttribute('aria-expanded', String(!!items.length));
  };
  const pick = (s) => {
    chosen = { name: s.name, lat: s.lat, lon: s.lon };
    input.value = s.name;
    items = [];
    close();
    $('#go').focus();
  };

  input.addEventListener('input', () => {
    chosen = null;
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { items = []; paint(); return; }
    timer = setTimeout(async () => {
      ctrl?.abort();
      ctrl = new AbortController();
      try {
        items = await suggest(q, ctrl.signal);
        active = items.length ? 0 : -1;
        paint();
      } catch (e) {
        if (e.name !== 'AbortError') { items = []; paint(); }
      }
    }, 250);
  });
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown' && items.length) { active = (active + 1) % items.length; paint(); e.preventDefault(); }
    else if (e.key === 'ArrowUp' && items.length) { active = (active - 1 + items.length) % items.length; paint(); e.preventDefault(); }
    else if (e.key === 'Enter' && items[active]) { pick(items[active]); e.preventDefault(); } // Invio sull'elenco sceglie, non cerca
    else if (e.key === 'Escape') close();
  });
  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li');
    if (li) { e.preventDefault(); pick(items[+li.dataset.i]); }
  });
  input.addEventListener('blur', () => setTimeout(close, 150));

  // La ricerca parte solo con "Cerca"
  $('#zone-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    close();
    const radius = +$('#radius').value;
    if (chosen) return run(chosen, radius);
    const q = input.value.trim();
    if (!q) return status('Scrivi una zona e sceglila dall\'elenco.', 'error');
    status('Cerco la zona…');
    try {
      const g = await geocode(q);
      if (!g.length) return status(`Non trovo "${q}". Prova a scegliere dall'elenco dei suggerimenti.`, 'error');
      chosen = { name: g[0].short, lat: g[0].lat, lon: g[0].lon };
      run(chosen, radius);
    } catch (err) {
      status(`Ricerca località non disponibile (${err.message}).`, 'error');
    }
  });
  $('#geoloc').addEventListener('click', () => {
    if (!navigator.geolocation) return status('Geolocalizzazione non disponibile in questo browser.', 'error');
    status('Rilevo la tua posizione…');
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude: lat, longitude: lon } = pos.coords;
      chosen = { name: await reverseGeocode(lat, lon), lat, lon };
      input.value = chosen.name;
      status('Posizione trovata: premi Cerca.', 'ok');
      setTimeout(() => status(null), 2500);
    }, () => status('Non riesco a rilevare la posizione: scrivi la zona.', 'error'), { timeout: 10000 });
  });
}

/* ---------------- Avvio ---------------- */
initMap();
initCombo();
const m = /^#zona=([-\d.]+),([-\d.]+),(\d+),(.*)$/.exec(location.hash);
if (m) {
  // link condiviso: apre direttamente la ricerca salvata nel link
  chosen = { lat: +m[1], lon: +m[2], name: decodeURIComponent(m[4]) };
  run(chosen, +m[3]);
}
