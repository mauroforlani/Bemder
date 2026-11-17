/* ==========================================================================
   Registro: sezioni collassabili (mappa e calendario) e mappa dei luoghi.

   Le attività non hanno coordinate: i luoghi toccati sono quelli scritti nel titolo
   (rifugi, cime, passi, laghi…). Vengono localizzati con la ricerca di OpenStreetMap
   (Nominatim) direttamente dal tuo browser, una sola volta: il risultato è salvato in
   questo browser e, se c'è il token GitHub, in attivita/data/poi.json (che puoi anche
   correggere a mano). Il file nel repository ha la precedenza.
   ========================================================================== */
(function () {
  "use strict";
  if (typeof L === "undefined" || typeof DATA === "undefined") return;

  var RS = window.RegistroSync;
  var POI_KEY = "registro_poi_v1", COLL_KEY = "registro_coll_v1", POI_PATH = "attivita/data/poi.json";
  var CENTER = [46.05, 9.85], ZOOM = 8;                        // Alpi lombarde
  var BOX = { w: 5.0, n: 48.2, e: 14.0, s: 43.8 };               // le Alpi: scarta risultati fuori area
  var STATI = { "Italia": 1, "Svizzera": 1, "Francia": 1, "Austria": 1, "Italia / Svizzera": 1 };
  var COLORS = { rifugio: "#c2410c", cima: "#15803d", passo: "#1d4ed8", lago: "#0891b2", altro: "#6b7280" };
  var LABELS = { rifugio: "Rifugi, baite, bivacchi", cima: "Cime", passo: "Passi e bocchette", lago: "Laghi", altro: "Altro" };

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var keyOf = function (n) { return n.trim().toLowerCase().replace(/\s+/g, " "); };

  /* ---------------- sezioni collassabili (stato ricordato) ---------------- */
  function collState() { try { return JSON.parse(localStorage.getItem(COLL_KEY) || "{}") || {}; } catch (e) { return {}; } }
  function setupColl(id, defOpen, onOpen) {
    var el = $(id); if (!el) return;
    var st = collState(); el.open = id in st ? !!st[id] : defOpen;
    el.addEventListener("toggle", function () {
      var s = collState(); s[id] = el.open; try { localStorage.setItem(COLL_KEY, JSON.stringify(s)); } catch (e) {}
      if (el.open && onOpen) onOpen();
    });
  }

  /* ---------------- luoghi: classificazione e raccolta dai titoli ---------------- */
  function kindOf(n) {
    var l = n.toLowerCase();
    if (/^(rifugio|capanna|baita|baite|bivacco|albergo|ristoro|alpe|alpeggio|malga|casera|casa|chalet|hotel|bar|trattoria|agriturismo)\b/.test(l)) return "rifugio";
    if (/^(passo|bocchetta|forcella|colle|sella|giogo|bocca|forcola|portjen|col)\b/.test(l)) return "passo";
    if (/^(lago|laghi|laghetto|lac)\b/.test(l)) return "lago";
    if (/^(monte|pizzo|cima|corno|grigna|grignetta|punta|sasso|torre|piz|mont|becca|cresta|picco|resegone|presolana|zuc|zucco|dente|croce|anticima|piramide|gran|rocciamelone|breithorn|dom|weiss|blinnenhorn|bric|testa)\b/.test(l)) return "cima";
    return "altro";
  }
  // chiave -> { name, ctx:{prov,reg,stato}, acts:[attività] } a partire da un elenco di attività
  function collect(rows, onlyAlps) {
    var idx = {};
    rows.forEach(function (a) {
      if (onlyAlps && !STATI[a.stato]) return;
      String(a.t || "").split(/\s*,\s*/).forEach(function (p) {
        p = p.trim(); if (!p) return;
        var k = keyOf(p), it = idx[k];
        if (!it) it = idx[k] = { name: p, ctx: { prov: a.prov, reg: a.reg, stato: a.stato }, acts: [] };
        it.acts.push(a);
      });
    });
    return idx;
  }

  /* ---------------- archivio dei luoghi (repository + browser) ---------------- */
  var store = {}, remoteKeys = {}, ready = false;
  function readLocal() { try { return JSON.parse(localStorage.getItem(POI_KEY) || "{}") || {}; } catch (e) { return {}; } }
  function saveLocal() { try { localStorage.setItem(POI_KEY, JSON.stringify(store)); } catch (e) {} }
  function loadStore() {
    var get = window.HUB && HUB.fetchRepoText ? HUB.fetchRepoText(POI_PATH, "../attivita/data/poi.json") : Promise.reject();
    return get.then(function (t) { return JSON.parse(t); }).catch(function () { return {}; }).then(function (remote) {
      remoteKeys = {}; store = {};
      Object.keys(remote || {}).forEach(function (k) { store[k] = remote[k]; remoteKeys[k] = 1; });
      var loc = readLocal(); Object.keys(loc).forEach(function (k) { if (!(k in store)) store[k] = loc[k]; });
      ready = true;
    });
  }
  function dirtyKeys() { return Object.keys(store).filter(function (k) { return !remoteKeys[k]; }); }

  /* ---------------- mappa ---------------- */
  var map = null, layer = null, dirty = true;
  function visible() { var d = $("coll-map"); return d && d.open && typeof S !== "undefined" && S.tab === "panoramica"; }
  function ensureMap() {
    if (map || !$("poi-map")) return;
    map = L.map("poi-map", { center: CENTER, zoom: ZOOM, scrollWheelZoom: true });
    var osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" });
    var topo = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", { maxZoom: 17, subdomains: "abc", attribution: "&copy; OpenStreetMap, SRTM | &copy; OpenTopoMap (CC-BY-SA)" });
    osm.addTo(map);
    L.control.layers({ "Strade (OpenStreetMap)": osm, "Rilievo (OpenTopoMap)": topo }, null, { collapsed: true }).addTo(map);
    layer = L.layerGroup().addTo(map);
  }
  function fmtAct(a) {
    var d = a.d.split("-").reverse().join("/"), km = a.km == null ? "" : " · " + a.km.toLocaleString("it-IT", { maximumFractionDigits: 1 }) + " km";
    var dp = a.dp ? " · +" + a.dp.toLocaleString("it-IT") + " m" : "";
    return d + " · " + esc(a.tipo) + km + dp;
  }
  function draw() {
    if (!map) return; dirty = false;
    layer.clearLayers();
    var idx = collect(typeof F !== "undefined" ? F : DATA, true), n = 0, pts = [];
    Object.keys(idx).forEach(function (k) {
      var p = store[k]; if (!p || p.nf || p.lat == null) return;
      var it = idx[k], kind = kindOf(it.name), c = COLORS[kind];
      var acts = it.acts.slice().sort(function (a, b) { return a.d < b.d ? 1 : -1; });
      var html = '<div class="poi-pop"><b>' + esc(it.name) + "</b><small>" + LABELS[kind] + (p.comune ? " · " + esc(p.comune) : "") + " · " + acts.length + (acts.length === 1 ? " attività" : " attività") + "</small><ul>" +
        acts.slice(0, 6).map(function (a) { return "<li>" + fmtAct(a) + "</li>"; }).join("") + (acts.length > 6 ? "<li>… e altre " + (acts.length - 6) + "</li>" : "") + "</ul></div>";
      L.circleMarker([p.lat, p.lng], { radius: 5 + Math.min(7, Math.sqrt(acts.length) * 1.6), color: "#fff", weight: 1.5, fillColor: c, fillOpacity: .85 })
        .bindPopup(html, { maxWidth: 300 }).addTo(layer);
      pts.push([p.lat, p.lng]); n++;
    });
    draw.pts = pts; stats(n);
  }
  function refresh() {
    if (!visible()) { dirty = true; return; }
    ensureMap(); if (!map) return;
    requestAnimationFrame(function () { map.invalidateSize(); draw(); });
  }

  /* ---------------- stato e pulsanti ---------------- */
  var running = false, stop = false;
  function counts() {
    var idx = collect(DATA, true), keys = Object.keys(idx), loc = 0, nf = 0;
    keys.forEach(function (k) { var p = store[k]; if (p) { if (p.nf) nf++; else loc++; } });
    return { total: keys.length, loc: loc, nf: nf, todo: keys.length - loc - nf, idx: idx };
  }
  function stats(shown) {
    var c = counts(), el = $("map-stat"); if (!el) return;
    el.textContent = (shown == null ? "" : shown + " luoghi sulla mappa · ") + c.loc + " localizzati su " + c.total + (c.nf ? " · " + c.nf + " non trovati" : "") + (c.todo ? " · " + c.todo + " da localizzare" : "");
    var b = $("map-locate"); if (b && !running) { b.hidden = !c.todo; b.textContent = "Localizza " + c.todo + (c.todo === 1 ? " luogo" : " luoghi"); }
    var d = dirtyKeys().length, s = $("map-save"); if (s) { s.hidden = !(d && RS && RS.ghConfig()); s.textContent = "Salva " + d + " luoghi su GitHub"; }
  }
  function msg(html, cls) { var m = $("map-msg"); if (m) { m.innerHTML = html || ""; m.className = "map-msg" + (cls ? " " + cls : ""); m.hidden = !html; } }

  /* ---------------- localizzazione (Nominatim) ---------------- */
  function search(q) {
    var url = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=3&addressdetails=1&accept-language=it&bounded=1" +
      "&viewbox=" + BOX.w + "," + BOX.n + "," + BOX.e + "," + BOX.s + "&q=" + encodeURIComponent(q);
    return fetch(url, { headers: { "Accept": "application/json" } }).then(function (r) {
      if (r.status === 429 || r.status === 503) { var e = new Error("limite di richieste raggiunto"); e.rate = true; throw e; }
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }
  function pickResult(list) {
    for (var i = 0; i < list.length; i++) {
      var lat = parseFloat(list[i].lat), lng = parseFloat(list[i].lon);
      if (lat >= BOX.s && lat <= BOX.n && lng >= BOX.w && lng <= BOX.e) {
        var ad = list[i].address || {};
        return { lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5, tipo: list[i].type || "",
                 comune: ad.village || ad.town || ad.city || ad.municipality || ad.hamlet || "" };
      }
    }
    return null;
  }
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  function geocode(it) {
    var c = it.ctx, parts = function (a) { return a.filter(Boolean).join(", "); };
    var q1 = parts([it.name, c.prov, c.reg === c.prov ? "" : c.reg, c.stato]);
    var q2 = parts([it.name, c.reg, c.stato]);
    return search(q1).then(function (l) {
      var r = pickResult(l); if (r || q2 === q1) return r;
      return wait(1100).then(function () { return search(q2); }).then(pickResult);
    });
  }
  function locate() {
    if (running) { stop = true; return; }
    var todo = []; var c = counts();
    Object.keys(c.idx).forEach(function (k) { if (!store[k]) todo.push([k, c.idx[k]]); });
    if (!todo.length) return;
    running = true; stop = false; var i = 0, done = 0, errs = 0; var b = $("map-locate"); b.textContent = "Ferma";
    msg("Localizzazione in corso: circa un luogo al secondo, puoi lasciare la pagina aperta. I risultati vengono salvati man mano.");
    (function next() {
      if (stop || i >= todo.length) return finish();
      var k = todo[i][0], it = todo[i][1]; i++;
      geocode(it).then(function (r) {
        store[k] = r ? { lat: r.lat, lng: r.lng, tipo: r.tipo, comune: r.comune } : { nf: 1 };
        saveLocal(); done++; errs = 0;
        msg("Localizzazione in corso: " + done + " di " + todo.length + " (" + it.name + ")"); stats(); if (done % 25 === 0) { dirty = true; refresh(); }
        return wait(1100);
      }).then(next).catch(function (e) {
        if (e && e.rate && errs < 2) { errs++; msg("Limite di richieste di OpenStreetMap: attendo un momento…"); i--; return wait(15000).then(next); }
        finish(e);
      });
    })();
    function finish(err) {
      running = false; var was = stop; stop = false; saveLocal(); dirty = true; refresh(); stats();
      if (err) msg("Localizzazione interrotta: " + esc(err.message || String(err)) + ". I luoghi già trovati sono stati salvati: puoi riprendere in seguito.", "err");
      else if (was) msg("Localizzazione fermata. I luoghi già trovati sono stati salvati.");
      else msg("Localizzazione completata: " + done + " luoghi elaborati.", "ok");
      if (!err && RS && RS.ghConfig() && dirtyKeys().length) saveRemote();
    }
  }
  function saveRemote() {
    var cfg = RS && RS.ghConfig(); if (!cfg) return;
    msg("Salvataggio dei luoghi su GitHub…");
    RS.ghUpdateFile(cfg, POI_PATH, function (text) {
      var remote = {}; try { remote = text ? JSON.parse(text) : {}; } catch (e) {}
      var out = {}; Object.keys(store).forEach(function (k) { out[k] = store[k]; });
      Object.keys(remote).forEach(function (k) { out[k] = remote[k]; });          // il file del repository ha la precedenza
      var sorted = {}; Object.keys(out).sort().forEach(function (k) { sorted[k] = out[k]; });
      return JSON.stringify(sorted, null, 1);
    }, "Registro: luoghi localizzati sulla mappa").then(function () {
      Object.keys(store).forEach(function (k) { remoteKeys[k] = 1; }); stats();
      msg("Luoghi salvati su GitHub (attivita/data/poi.json).", "ok");
    }).catch(function (e) { msg("Salvataggio su GitHub non riuscito: " + esc(e.message || String(e)) + ". I luoghi restano in questo browser.", "err"); });
  }

  /* ---------------- avvio ---------------- */
  function boot() {
    setupColl("coll-map", true, function () { refresh(); });
    setupColl("coll-cal", false, function () { var el = $("ch-cum"); if (el && DATA.length && typeof F !== "undefined" && F.length && typeof calHeat === "function") calHeat(el); });
    if ($("map-locate")) $("map-locate").onclick = locate;
    if ($("map-save")) $("map-save").onclick = saveRemote;
    if ($("map-fit")) $("map-fit").onclick = function () { ensureMap(); if (map && draw.pts && draw.pts.length) map.fitBounds(draw.pts, { padding: [30, 30], maxZoom: 13 }); };
    var legend = $("map-legend"); if (legend) legend.innerHTML = Object.keys(COLORS).map(function (k) { return '<span><i style="background:' + COLORS[k] + '"></i>' + LABELS[k] + "</span>"; }).join("");
    var origUpdate = window.update;
    if (typeof origUpdate === "function") window.update = function () { var r = origUpdate.apply(this, arguments); stats(); refresh(); return r; };
    loadStore().then(function () { stats(); refresh(); });
  }
  document.addEventListener("DOMContentLoaded", boot);
  window.RegistroMappa = { collect: collect, kindOf: kindOf };   // per verifiche
})();
