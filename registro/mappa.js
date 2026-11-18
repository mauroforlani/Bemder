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
  var EDIT_KEY = "registro_poi_edits_v1";
  var store = {}, remoteKeys = {}, edits = {}, ready = false;
  function readLocal() { try { return JSON.parse(localStorage.getItem(POI_KEY) || "{}") || {}; } catch (e) { return {}; } }
  function saveLocal() { try { localStorage.setItem(POI_KEY, JSON.stringify(store)); localStorage.setItem(EDIT_KEY, JSON.stringify(edits)); } catch (e) {} }
  function loadStore() {
    var get = window.HUB && HUB.fetchRepoText ? HUB.fetchRepoText(POI_PATH, "../attivita/data/poi.json") : Promise.reject();
    return get.then(function (t) { return JSON.parse(t); }).catch(function () { return {}; }).then(function (remote) {
      remoteKeys = {}; store = {};
      Object.keys(remote || {}).forEach(function (k) { store[k] = remote[k]; remoteKeys[k] = 1; });
      var loc = readLocal(); try { edits = JSON.parse(localStorage.getItem(EDIT_KEY) || "{}") || {}; } catch (e) { edits = {}; }
      Object.keys(loc).forEach(function (k) { if (!(k in store)) store[k] = loc[k]; });
      Object.keys(edits).forEach(function (k) {                    // correzioni manuali non ancora nel repository: prevalgono
        if (k in loc) store[k] = loc[k]; else delete store[k];
      });
      ready = true;
    });
  }
  function dirtyKeys() {
    var o = {};
    Object.keys(store).forEach(function (k) { if (!remoteKeys[k]) o[k] = 1; });
    Object.keys(edits).forEach(function (k) { o[k] = 1; });
    return Object.keys(o);
  }
  // modifica manuale di un luogo (data = nuovo valore, null = rimuovi)
  var autoSaveT = null;
  function setPlace(k, data) {
    if (data) store[k] = data; else delete store[k];
    edits[k] = 1; saveLocal(); dirty = true; stats(); refresh();
    if (RS && RS.ghConfig()) { clearTimeout(autoSaveT); autoSaveT = setTimeout(saveRemote, 5000); }   // salva da solo dopo 5 secondi
  }

  /* ---------------- mappa ---------------- */
  var map = null, layer = null, dirty = true, markers = {};
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
    layer.clearLayers(); markers = {};
    var idx = collect(typeof F !== "undefined" ? F : DATA, false), n = 0, pts = [];
    Object.keys(idx).forEach(function (k) {
      var p = store[k]; if (!p || p.nf || p.lat == null) return;
      var it = idx[k], kind = kindOf(it.name), c = COLORS[kind];
      var acts = it.acts.slice().sort(function (a, b) { return a.d < b.d ? 1 : -1; });
      var html = '<div class="poi-pop"><b>' + esc(it.name) + "</b><small>" + LABELS[kind] + (p.comune ? " · " + esc(p.comune) : "") + " · " + acts.length + (acts.length === 1 ? " attività" : " attività") + "</small><ul>" +
        acts.slice(0, 6).map(function (a) { return "<li>" + fmtAct(a) + "</li>"; }).join("") + (acts.length > 6 ? "<li>… e altre " + (acts.length - 6) + "</li>" : "") + '</ul><button type="button" class="poi-fix" data-k="' + esc(k) + '">Rettifica posizione…</button></div>';
      L.circleMarker([p.lat, p.lng], { radius: 5 + Math.min(7, Math.sqrt(acts.length) * 1.6), color: "#fff", weight: 1.5, fillColor: c, fillOpacity: .85 })
        .bindPopup(html, { maxWidth: 300 }).addTo(layer).on("popupopen", function (e) {
          var b = e.popup.getElement().querySelector(".poi-fix"); if (b) b.onclick = function () { map.closePopup(); openManage({ q: it.name, f: "all", open: k }); };
        });
      pts.push([p.lat, p.lng]); n++;
      markers[k] = layer.getLayers()[layer.getLayers().length - 1];
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
    el.textContent = (shown == null ? "" : shown + " luoghi sulla mappa · ") + c.loc + " localizzati su " + c.total + (c.nf ? " · " + c.nf + (c.nf === 1 ? " non trovato" : " non trovati") : "") + (c.todo ? " · " + c.todo + " da localizzare" : "");
    var b = $("map-locate"); if (b && !running) { b.hidden = !c.todo; b.textContent = "Localizza " + c.todo + (c.todo === 1 ? " luogo" : " luoghi"); }
    var d = dirtyKeys().length, s = $("map-save"); if (s) { s.hidden = !(d && RS && RS.ghConfig()); s.textContent = "Salva " + d + (d === 1 ? " modifica" : " modifiche") + " su GitHub"; }
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
    clearTimeout(autoSaveT);
    var snapshot = Object.keys(edits);
    msg("Salvataggio dei luoghi su GitHub…");
    RS.ghUpdateFile(cfg, POI_PATH, function (text) {
      var remote = {}; try { remote = text ? JSON.parse(text) : {}; } catch (e) {}
      var out = {}; Object.keys(store).forEach(function (k) { out[k] = store[k]; });
      Object.keys(remote).forEach(function (k) { out[k] = remote[k]; });          // il file del repository ha la precedenza…
      snapshot.forEach(function (k) { if (k in store) out[k] = store[k]; else delete out[k]; });   // …tranne le tue correzioni
      var sorted = {}; Object.keys(out).sort().forEach(function (k) { sorted[k] = out[k]; });
      return JSON.stringify(sorted, null, 1);
    }, "Registro: luoghi sulla mappa").then(function () {
      remoteKeys = {}; Object.keys(store).forEach(function (k) { remoteKeys[k] = 1; });
      snapshot.forEach(function (k) { delete edits[k]; }); saveLocal(); stats();
      msg("Luoghi salvati su GitHub (attivita/data/poi.json).", "ok");
    }).catch(function (e) { msg("Salvataggio su GitHub non riuscito: " + esc(e.message || String(e)) + ". Le modifiche restano in questo browser.", "err"); });
  }

  /* ---------------- rivedi luoghi: compilare i non trovati, rettificare gli automatici ---------------- */
  var mst = { f: "nf", q: "", all: false, open: null, mode: null, res: null, limit: 80 };
  function statusOf(k) { var p = store[k]; if (!p) return "todo"; if (p.nf) return "nf"; return p.man ? "man" : "auto"; }
  var STATUS_LABEL = { nf: "Non trovato", todo: "Da localizzare", auto: "Automatico", man: "Manuale" };
  function modalEl() {
    var el = $("poi-modal"); if (el) return el;
    el = document.createElement("div"); el.className = "imp-overlay"; el.id = "poi-modal"; el.hidden = true;
    el.innerHTML = '<div class="imp-box" role="dialog" aria-modal="true" aria-labelledby="poi-title"><button class="imp-x" id="poi-x" aria-label="Chiudi">✕</button><div id="poi-body"></div></div>';
    document.body.appendChild(el);
    el.addEventListener("mousedown", function (e) { if (e.target === el) closeManage(); });
    $("poi-x").onclick = closeManage;
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !el.hidden) closeManage(); });
    $("poi-body").addEventListener("click", onManageClick);
    $("poi-body").addEventListener("input", function (e) {
      if (e.target.id === "poi-q") { mst.q = e.target.value; mst.limit = 80; renderList(); }
    });
    $("poi-body").addEventListener("change", function (e) { if (e.target.id === "poi-all") { mst.all = e.target.checked; renderManage(); } });
    $("poi-body").addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      if (e.target.id === "poi-sq") doSearch(); else if (e.target.id === "poi-cq") doCoord();
    });
    return el;
  }
  function closeManage() { var el = $("poi-modal"); if (el) el.hidden = true; }
  function openManage(o) {
    modalEl(); mst = { f: "nf", q: "", all: false, open: null, mode: null, res: null, limit: 80 };
    if (o) for (var k in o) mst[k] = o[k];
    if (mst.open) mst.mode = "search";
    renderManage(); $("poi-modal").hidden = false;
  }
  function manageItems() {
    var idx = collect(DATA, !mst.all), q = mst.q.trim().toLowerCase(), out = [];
    Object.keys(idx).forEach(function (k) {
      var it = idx[k]; if (q && it.name.toLowerCase().indexOf(q) < 0) return;
      out.push({ k: k, it: it, st: statusOf(k) });
    });
    var rank = { nf: 0, todo: 1, auto: 2, man: 3 };
    out.sort(function (a, b) { return rank[a.st] - rank[b.st] || b.it.acts.length - a.it.acts.length || a.it.name.localeCompare(b.it.name, "it"); });
    return out;
  }
  function renderManage() {
    var all = manageItems(), cnt = { all: all.length, nf: 0, todo: 0, auto: 0, man: 0 };
    all.forEach(function (x) { cnt[x.st]++; });
    var chip = function (f, label) { return '<button type="button" class="chip' + (mst.f === f ? " on" : "") + '" data-act="filter" data-f="' + f + '">' + label + " (" + cnt[f] + ")</button>"; };
    $("poi-body").innerHTML = '<h3 id="poi-title">Rivedi i luoghi</h3>' +
      '<p class="imp-sub">Compila i luoghi non trovati o correggi quelli messi in automatico. Le tue correzioni hanno la precedenza e si salvano in <i>attivita/data/poi.json</i>.</p>' +
      '<div class="poi-tools">' + chip("nf", "Non trovati") + chip("todo", "Da localizzare") + chip("auto", "Automatici") + chip("man", "Manuali") + chip("all", "Tutti") +
      '<input type="search" id="poi-q" placeholder="Cerca un luogo…" value="' + esc(mst.q) + '"><label><input type="checkbox" id="poi-all"' + (mst.all ? " checked" : "") + '> anche fuori dalle Alpi</label></div>' +
      '<div class="poi-list" id="poi-list"></div><div id="poi-status"></div>' +
      '<div class="imp-foot"><span class="grow" id="poi-foot"></span><button class="btn dark" type="button" data-act="close">Chiudi</button></div>';
    renderList();
  }
  function renderList() {
    var items = manageItems().filter(function (x) { return mst.f === "all" || x.st === mst.f; });
    var show = items.slice(0, mst.limit), html = "";
    show.forEach(function (x) { html += rowHtml(x); });
    if (!items.length) html = '<div class="poi-row"><div class="poi-meta">Nessun luogo in questo elenco.</div></div>';
    if (items.length > show.length) html += '<div class="poi-row"><button type="button" class="chip" data-act="more">Mostra altri (' + (items.length - show.length) + ')</button></div>';
    $("poi-list").innerHTML = html;
    var d = dirtyKeys().length;
    $("poi-foot").textContent = d ? d + (d === 1 ? " modifica non ancora su GitHub" : " modifiche non ancora su GitHub") + (RS && RS.ghConfig() ? " (si salvano da sole)" : " · imposta il token in Attività per salvarle nel repository") : "";
  }
  function rowHtml(x) {
    var p = store[x.k], it = x.it, last = it.acts.reduce(function (m, a) { return a.d > m ? a.d : m; }, "");
    var where = p && !p.nf ? p.lat.toFixed(4) + ", " + p.lng.toFixed(4) + (p.comune ? " · " + esc(p.comune) : "") : "";
    var acts = '<button type="button" data-act="search" data-k="' + esc(x.k) + '">Cerca</button>' +
      '<button type="button" data-act="map" data-k="' + esc(x.k) + '">Sulla mappa</button>' +
      '<button type="button" data-act="coord" data-k="' + esc(x.k) + '">Coordinate</button>' +
      (p && !p.nf ? '<button type="button" data-act="show" data-k="' + esc(x.k) + '">Vedi</button>' : "") +
      (x.st !== "nf" ? '<button type="button" data-act="nf" data-k="' + esc(x.k) + '">Non trovato</button>' : "") +
      (p ? '<button type="button" data-act="remove" data-k="' + esc(x.k) + '">Rimuovi</button>' : "");
    var panel = mst.open === x.k ? panelHtml(x) : "";
    return '<div class="poi-row"><div><div class="poi-name">' + esc(it.name) + '</div><div class="poi-meta"><span class="poi-badge ' + x.st + '">' + STATUS_LABEL[x.st] + "</span>" +
      LABELS[kindOf(it.name)] + " · " + it.acts.length + (it.acts.length === 1 ? " attività" : " attività") + " · ultima " + last.split("-").reverse().join("/") +
      (it.ctx.prov ? " · " + esc(it.ctx.prov) : "") + (where ? "<br>" + where : "") + '</div></div><div class="poi-acts">' + acts + "</div>" + panel + "</div>";
  }
  function panelHtml(x) {
    if (mst.mode === "coord") {
      return '<div class="poi-panel"><div class="line"><input type="text" id="poi-cq" placeholder="Coordinate, es. 46.0123, 9.7654" autocomplete="off"><button type="button" data-act="setcoord" data-k="' + esc(x.k) + '">Imposta</button></div>' +
        '<div class="poi-help">Su Google Maps o OpenStreetMap: tasto destro sul punto → copia le coordinate e incollale qui.</div></div>';
    }
    var c = x.it.ctx, q = mst.sq != null ? mst.sq : [x.it.name, c.prov, c.stato].filter(Boolean).join(", ");
    var res = mst.res == null ? "" : !mst.res.length ? '<div class="poi-help">Nessun risultato. Prova a cambiare le parole o usa “Sulla mappa”.</div>' :
      '<ul class="poi-res">' + mst.res.map(function (r, i) { return '<li><div>' + esc(r.title) + "<small>" + esc(r.sub) + '</small></div><button type="button" data-act="pick" data-k="' + esc(x.k) + '" data-i="' + i + '">Usa questo</button></li>'; }).join("") + "</ul>";
    return '<div class="poi-panel"><div class="line"><input type="text" id="poi-sq" value="' + esc(q) + '" autocomplete="off"><button type="button" data-act="dosearch" data-k="' + esc(x.k) + '">Cerca su OpenStreetMap</button></div>' + res + "</div>";
  }
  function pstatus(html, cls) { var m = $("poi-status"); if (m) m.innerHTML = html ? '<div class="map-msg ' + (cls || "") + '">' + html + "</div>" : ""; }

  function doSearch() {
    var inp = $("poi-sq"); if (!inp) return; mst.sq = inp.value; pstatus("Ricerca in corso…");
    var url = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&addressdetails=1&accept-language=it&viewbox=" + BOX.w + "," + BOX.n + "," + BOX.e + "," + BOX.s + "&q=" + encodeURIComponent(mst.sq);
    fetch(url, { headers: { "Accept": "application/json" } }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }).then(function (list) {
      mst.res = list.map(function (r) {
        var ad = r.address || {};
        return { lat: parseFloat(r.lat), lng: parseFloat(r.lon), tipo: r.type || "", comune: ad.village || ad.town || ad.city || ad.municipality || ad.hamlet || "",
                 title: (r.display_name || "").split(",").slice(0, 3).join(","), sub: (r.type || "") + " · " + parseFloat(r.lat).toFixed(4) + ", " + parseFloat(r.lon).toFixed(4) };
      }); pstatus(""); renderList(); var i2 = $("poi-sq"); if (i2) i2.focus();
    }).catch(function (e) { pstatus("Ricerca non riuscita: " + esc(e.message || String(e)), "err"); });
  }
  function parseCoord(t) {
    t = String(t).trim().replace(/[°]/g, "").replace(/;/g, " ");
    var m = /^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/.exec(t);
    if (!m) { var d = /^(-?\d+(?:,\d+)?)\s+(-?\d+(?:,\d+)?)$/.exec(t); if (d) m = [0, d[1].replace(",", "."), d[2].replace(",", ".")]; }
    if (!m) return null;
    var lat = parseFloat(m[1]), lng = parseFloat(m[2]);
    return (lat >= 30 && lat <= 72 && lng >= -30 && lng <= 40) ? { lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5 } : null;
  }
  function doCoord() {
    var inp = $("poi-cq"); if (!inp || !mst.open) return;
    var c = parseCoord(inp.value);
    if (!c) { pstatus("Coordinate non valide. Usa il formato 46.0123, 9.7654 (latitudine, longitudine).", "err"); return; }
    place(mst.open, { lat: c.lat, lng: c.lng, tipo: "", comune: "", man: 1 }, true);
  }
  function reverseComune(k, lat, lng) {
    fetch("https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&accept-language=it&lat=" + lat + "&lon=" + lng, { headers: { "Accept": "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
        var ad = j && j.address; var c = ad && (ad.village || ad.town || ad.city || ad.municipality || ad.hamlet);
        if (c && store[k] && store[k].man && store[k].lat === lat && store[k].lng === lng) { store[k].comune = c; saveLocal(); dirty = true; refresh(); if (RS && RS.ghConfig()) { clearTimeout(autoSaveT); autoSaveT = setTimeout(saveRemote, 5000); } }
      }).catch(function () {});
  }
  function place(k, data, reopen) {
    setPlace(k, data); mst.open = null; mst.mode = null; mst.res = null; mst.sq = null;
    if (!data.comune && data.lat != null) reverseComune(k, data.lat, data.lng);
    if (reopen) { renderManage(); pstatus("Posizione salvata.", "ok"); }
  }
  function placeOnMap(k) {
    var it = collect(DATA, false)[k]; closeManage();
    var d = $("coll-map"); if (d) d.open = true;
    ensureMap(); if (!map) return;
    if (d) d.scrollIntoView({ behavior: "smooth", block: "start" });
    var c = map.getContainer(); c.classList.add("map-place");
    msg("Clicca sulla mappa il punto esatto di «" + esc(it ? it.name : k) + "». <button type=\"button\" class=\"imp-link\" id=\"map-cancel\">Annulla</button>");
    var done = function () { c.classList.remove("map-place"); map.off("click", onClick); };
    var onClick = function (e) {
      done(); var lat = Math.round(e.latlng.lat * 1e5) / 1e5, lng = Math.round(e.latlng.lng * 1e5) / 1e5;
      place(k, { lat: lat, lng: lng, tipo: "", comune: "", man: 1 }, false); msg("Posizione di «" + esc(it ? it.name : k) + "» salvata.", "ok");
      setTimeout(function () { openManage({ f: "all", q: it ? it.name : "" }); }, 700);
    };
    map.on("click", onClick);
    var cancel = $("map-cancel"); if (cancel) cancel.onclick = function () { done(); msg(""); openManage({ f: "all", q: it ? it.name : "" }); };
  }
  function showOnMap(k) {
    var p = store[k]; if (!p || p.nf) return; closeManage();
    var d = $("coll-map"); if (d) d.open = true; ensureMap(); if (!map) return; draw();
    if (d) d.scrollIntoView({ behavior: "smooth", block: "start" });
    map.setView([p.lat, p.lng], 13); if (markers[k]) markers[k].openPopup();
  }
  function onManageClick(e) {
    var b = e.target.closest("[data-act]"); if (!b) return;
    var act = b.dataset.act, k = b.dataset.k;
    if (act === "close") return closeManage();
    if (act === "filter") { mst.f = b.dataset.f; mst.limit = 80; mst.open = null; mst.mode = null; mst.res = null; return renderManage(); }
    if (act === "more") { mst.limit += 120; return renderList(); }
    if (act === "search" || act === "coord") { mst.open = mst.open === k && mst.mode === (act === "coord" ? "coord" : "search") ? null : k; mst.mode = act === "coord" ? "coord" : "search"; mst.res = null; mst.sq = null; renderList(); var f = $(act === "coord" ? "poi-cq" : "poi-sq"); if (f) f.focus(); return; }
    if (act === "dosearch") return doSearch();
    if (act === "setcoord") return doCoord();
    if (act === "pick") { var r = mst.res && mst.res[+b.dataset.i]; if (r) place(k, { lat: Math.round(r.lat * 1e5) / 1e5, lng: Math.round(r.lng * 1e5) / 1e5, tipo: r.tipo, comune: r.comune, man: 1 }, true); return; }
    if (act === "map") return placeOnMap(k);
    if (act === "show") return showOnMap(k);
    if (act === "nf") { setPlace(k, { nf: 1, man: 1 }); mst.open = null; return renderManage(); }
    if (act === "remove") { setPlace(k, null); mst.open = null; return renderManage(); }
  }

  /* ---------------- avvio ---------------- */
  function boot() {
    setupColl("coll-map", true, function () { refresh(); });
    setupColl("coll-cal", false, function () { var el = $("ch-cum"); if (el && DATA.length && typeof F !== "undefined" && F.length && typeof calHeat === "function") calHeat(el); });
    if ($("map-locate")) $("map-locate").onclick = locate;
    if ($("map-edit")) $("map-edit").onclick = function () { openManage(); };
    if ($("map-save")) $("map-save").onclick = saveRemote;
    if ($("map-fit")) $("map-fit").onclick = function () { ensureMap(); if (map && draw.pts && draw.pts.length) map.fitBounds(draw.pts, { padding: [30, 30], maxZoom: 13 }); };
    var legend = $("map-legend"); if (legend) legend.innerHTML = Object.keys(COLORS).map(function (k) { return '<span><i style="background:' + COLORS[k] + '"></i>' + LABELS[k] + "</span>"; }).join("");
    var origUpdate = window.update;
    if (typeof origUpdate === "function") window.update = function () { var r = origUpdate.apply(this, arguments); stats(); refresh(); return r; };
    loadStore().then(function () { stats(); refresh(); });
  }
  document.addEventListener("DOMContentLoaded", boot);
  window.RegistroMappa = { collect: collect, kindOf: kindOf, parseCoord: parseCoord };   // per verifiche
})();
