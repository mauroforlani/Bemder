/* ==========================================================================
   registro-sync.js — aggiornamento del Registro attività.
   Usato da due punti:
     - Registro (importazione manuale dei CSV, completamento delle località)
     - Running: quando carichi un CSV Garmin di Trail/Hiking, le stesse attività
       vengono aggiunte in automatico anche al Registro.

   Dove finiscono i dati:
     - sempre in questo browser (chiave registro_extra_v1, letta dal Registro)
     - nel repository (attivita/data/attivita.json e .js) se in Attività è stato
       impostato il token GitHub.
   ========================================================================== */
(function () {
  "use strict";

  var EXTRA_KEY = "registro_extra_v1";
  var GH_KEY = "sentieri_gh_config_v1";            // stessa configurazione di Attività
  var JSON_PATH = "attivita/data/attivita.json";
  var JS_PATH = "attivita/data/attivita.js";
  var STATIC_URL = "../attivita/data/attivita.json";
  var PLACEHOLDER = "Da verificare";
  var FIELDS = ["id", "d", "h", "tipo", "t", "stato", "reg", "prov", "sg", "km", "dp", "dn", "tot", "mov",
                "qmin", "qmax", "hr", "hrmax", "cal", "tmin", "tmax", "passi", "te", "multi", "verif"];
  var TIPI_GARMIN = { "hiking": "Escursione", "trail running": "Trail Running" };

  var keyOf = function (x) { return x.d + "|" + x.h; };
  var byKey = function (a, b) { var ka = keyOf(a), kb = keyOf(b); return ka < kb ? -1 : ka > kb ? 1 : 0; };
  function pick(x) { var o = {}; FIELDS.forEach(function (f) { o[f] = x[f] === undefined ? null : x[f]; }); return o; }
  function isPlaceholder(x) { return x.prov === PLACEHOLDER || x.stato === PLACEHOLDER; }

  /* ---------------- lettura CSV Garmin ---------------- */
  function parseCsv(text) {
    text = text.replace(/^\uFEFF/, "");
    var first = text.split(/\r?\n/, 1)[0] || "";
    var delim = first.split(";").length > first.split(",").length ? ";" : ",";
    var rows = [], row = [], cur = "", inQ = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQ) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
        else cur += c;
      } else if (c === '"') inQ = true;
      else if (c === delim) { row.push(cur); cur = ""; }
      else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else if (c !== "\r") cur += c;
    }
    if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(function (r) { return r.length > 1 || (r[0] || "").trim() !== ""; });
  }
  function clean(s) { s = s == null ? "" : String(s).trim(); return (s === "" || s === "--" || s === "-") ? null : s; }
  function toFloat(s) {            // "10,94" -> 10.94
    s = clean(s); if (s == null) return null;
    if (s.indexOf(",") > -1) s = s.replace(/\./g, "").replace(",", ".");
    var v = parseFloat(s); return isNaN(v) ? null : v;
  }
  function toInt(s) {              // "1.648" (migliaia) -> 1648
    s = clean(s); if (s == null) return null;
    var v = parseFloat(s.replace(/\./g, "").replace(",", ".")); return isNaN(v) ? null : Math.round(v);
  }
  function toSecs(s) {
    s = clean(s); if (s == null) return null;
    var p = s.replace(",", ".").split(":").map(Number);
    if (p.some(isNaN)) return null;
    if (p.length === 3) return Math.floor(p[0] * 3600 + p[1] * 60 + p[2]);
    if (p.length === 2) return Math.floor(p[0] * 60 + p[1]);
    return null;
  }
  var round = function (v, n) { return v == null ? null : Math.round(v * Math.pow(10, n)) / Math.pow(10, n); };

  function mapRow(idx, r) {
    function g() {
      for (var k = 0; k < arguments.length; k++) { var i = idx[arguments[k].toLowerCase()]; if (i != null) return r[i]; }
      return null;
    }
    var tipo = TIPI_GARMIN[(clean(g("Activity Type")) || "").toLowerCase()];
    if (!tipo) return { skip: "tipo" };
    var m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/.exec(clean(g("Date")) || "");
    if (!m) return { skip: "data" };
    var tot = toSecs(g("Time")), mov = toSecs(g("Moving Time"));
    return { rec: {
      id: 0, d: m[1], h: m[2] + ":" + m[3], tipo: tipo, t: (clean(g("Title")) || "").trim(),
      stato: "", reg: "", prov: "", sg: null,
      km: round(toFloat(g("Distance")), 2),
      dp: toInt(g("Ascent", "Total Ascent")), dn: toInt(g("Total Descent")),
      tot: tot, mov: mov,
      qmin: toInt(g("Min Elevation")), qmax: toInt(g("Max Elevation")),
      hr: toInt(g("Avg HR")), hrmax: toInt(g("Max HR")), cal: toInt(g("Calories")),
      tmin: null, tmax: null, passi: toInt(g("Steps")), te: round(toFloat(g("Aerobic TE")), 1),
      multi: !!(tot && mov && tot > 12 * 3600 && tot > 2 * mov), verif: false
    } };
  }
  function parseGarmin(text) {
    var rows = parseCsv(text);
    if (rows.length < 2) return { recs: [], skipped: 0, bad: true };
    var idx = {};
    rows[0].forEach(function (name, i) { idx[String(name).trim().toLowerCase()] = i; });
    if (idx["activity type"] == null || idx["date"] == null || idx["title"] == null) return { recs: [], skipped: 0, bad: true };
    var recs = [], skipped = 0;
    rows.slice(1).forEach(function (r) { var o = mapRow(idx, r); if (o.rec) recs.push(o.rec); else skipped++; });
    return { recs: recs, skipped: skipped, bad: false };
  }

  /* ---------------- dati locali ---------------- */
  function readExtra() { try { return JSON.parse(localStorage.getItem(EXTRA_KEY) || "[]") || []; } catch (e) { return []; } }
  function writeExtra(a) { try { localStorage.setItem(EXTRA_KEY, JSON.stringify(a)); } catch (e) {} }

  /* ---------------- località ---------------- */
  function locIndex(arr) {         // titolo (minuscolo) -> ultima località nota
    var byTitle = {};
    arr.slice().sort(byKey).forEach(function (x) {
      if (isPlaceholder(x)) return;
      byTitle[(x.t || "").toLowerCase()] = { stato: x.stato, reg: x.reg, prov: x.prov, sg: x.sg };
    });
    return byTitle;
  }
  function applyLocation(r, info) {
    if (info) { r.stato = info.stato; r.reg = info.reg; r.prov = info.prov; r.sg = info.sg; r.verif = false; }
    else { r.stato = r.reg = r.prov = PLACEHOLDER; r.sg = null; r.verif = true; }
    return r;
  }

  /* ---------------- GitHub ---------------- */
  function ghConfig() {
    try {
      var c = JSON.parse(localStorage.getItem(GH_KEY) || "null");
      if (!c) return null;
      c = window.HUB && HUB.migrateGhConfig ? HUB.migrateGhConfig(c, "attivita", "data/luoghi.json") : c;
      return (c.token && c.repo && c.branch) ? c : null;
    } catch (e) { return null; }
  }
  function b64dec(b64) { var bin = atob(b64.replace(/\s/g, "")), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new TextDecoder("utf-8").decode(u).replace(/^\uFEFF/, ""); }
  function b64enc(s) { var u = new TextEncoder().encode(s), bin = ""; for (var i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(bin); }
  var encPath = function (p) { return p.split("/").map(encodeURIComponent).join("/"); };

  /* Aggiunge `recs` (nuove) e applica `updates` (correzioni di località) ad attivita.json/.js nel repository. */
  function ghSave(cfg, recs, updates) {
    recs = recs || []; updates = updates || [];
    var base = "https://api.github.com/repos/" + cfg.repo + "/contents/";
    var headers = { "Authorization": "Bearer " + cfg.token, "Accept": "application/vnd.github+json" };
    function get(path) {
      return fetch(base + encPath(path) + "?ref=" + encodeURIComponent(cfg.branch), { headers: headers }).then(function (r) {
        if (r.status === 404) return null;
        if (!r.ok) throw new Error("Lettura di " + path + " non riuscita (" + r.status + ")");
        return r.json().then(function (j) { return { sha: j.sha, text: b64dec(j.content) }; });
      });
    }
    function put(path, text, sha, msg) {
      var body = { message: msg, content: b64enc(text), branch: cfg.branch }; if (sha) body.sha = sha;
      return fetch(base + encPath(path), { method: "PUT", headers: Object.assign({ "Content-Type": "application/json" }, headers), body: JSON.stringify(body) }).then(function (r) {
        if (!r.ok) return r.text().then(function (t) { throw new Error("Salvataggio di " + path + " non riuscito (" + r.status + ") " + t.slice(0, 120)); });
      });
    }
    return get(JSON_PATH).then(function (cur) {
      if (!cur) throw new Error("File " + JSON_PATH + " non trovato nel repository");
      var arr = JSON.parse(cur.text), pos = {}; arr.forEach(function (x, i) { pos[keyOf(x)] = i; });
      var added = 0, updated = 0;
      recs.forEach(function (x) { if (pos[keyOf(x)] == null) { pos[keyOf(x)] = arr.length; arr.push(pick(x)); added++; } });
      updates.forEach(function (u) {
        var i = pos[keyOf(u)]; if (i == null) return;
        ["stato", "reg", "prov", "sg", "verif"].forEach(function (f) { arr[i][f] = u[f] === undefined ? null : u[f]; });
        updated++;
      });
      if (!added && !updated) return { added: 0, updated: 0 };
      var parts = [];
      if (added) parts.push("aggiunte " + added + " attività");
      if (updated) parts.push("località di " + updated + " attività");
      var msg = "Registro: " + parts.join(", ");
      arr.sort(byKey); arr.forEach(function (x, i) { x.id = i + 1; });
      var text = JSON.stringify(arr);
      return put(JSON_PATH, text, cur.sha, msg).then(function () { return get(JS_PATH); }).then(function (js) {
        return put(JS_PATH, "window.ATTIVITA=" + text + ";", js ? js.sha : null, msg);
      }).then(function () { return { added: added, updated: updated }; });
    });
  }


  /* Legge un file del repository, lo trasforma con transform(testo|null) e lo riscrive (se cambia). */
  function ghUpdateFile(cfg, path, transform, msg) {
    var base = "https://api.github.com/repos/" + cfg.repo + "/contents/" + encPath(path);
    var headers = { "Authorization": "Bearer " + cfg.token, "Accept": "application/vnd.github+json" };
    return fetch(base + "?ref=" + encodeURIComponent(cfg.branch), { headers: headers }).then(function (r) {
      if (r.status === 404) return null;
      if (!r.ok) throw new Error("Lettura di " + path + " non riuscita (" + r.status + ")");
      return r.json().then(function (j) { return { sha: j.sha, text: b64dec(j.content) }; });
    }).then(function (cur) {
      var next = transform(cur ? cur.text : null);
      if (next == null || (cur && next === cur.text)) return { changed: false };
      var body = { message: msg, content: b64enc(next), branch: cfg.branch }; if (cur) body.sha = cur.sha;
      return fetch(base, { method: "PUT", headers: Object.assign({ "Content-Type": "application/json" }, headers), body: JSON.stringify(body) }).then(function (r) {
        if (!r.ok) return r.text().then(function (t) { throw new Error("Salvataggio di " + path + " non riuscito (" + r.status + ") " + t.slice(0, 120)); });
        return { changed: true };
      });
    });
  }

  /* ---------------- aggiornamento automatico da testi CSV (usato da Running) ---------------- */
  function fetchStatic() {
    var get = window.HUB && HUB.fetchRepoText ? HUB.fetchRepoText(JSON_PATH, STATIC_URL) : fetch(STATIC_URL, { cache: "no-store" }).then(function (r) { return r.text(); });
    return get.then(function (t) { return JSON.parse(t); }).catch(function () { return []; });
  }
  function syncFromGarminTexts(texts) {
    var recs = [], seenIn = {};
    texts.forEach(function (t) {
      var p = parseGarmin(t); if (p.bad) return;
      p.recs.forEach(function (r) { if (!seenIn[keyOf(r)]) { seenIn[keyOf(r)] = 1; recs.push(r); } });
    });
    if (!recs.length) return Promise.resolve({ added: 0, dup: 0, none: true });
    return fetchStatic().then(function (base) {
      var overlay = readExtra(), have = {};
      base.forEach(function (x) { have[keyOf(x)] = 1; });
      overlay.forEach(function (x) { if (!x.upd) have[keyOf(x)] = 1; });
      var fresh = recs.filter(function (r) { return !have[keyOf(r)]; });
      var out = { added: fresh.length, dup: recs.length - fresh.length, placeholders: 0, github: false };
      if (!fresh.length) return out;
      var idx = locIndex(base.concat(overlay.filter(function (x) { return !x.upd; })));
      fresh.forEach(function (r) { applyLocation(r, idx[r.t.toLowerCase()]); });
      out.placeholders = fresh.filter(function (r) { return r.verif; }).length;
      writeExtra(overlay.concat(fresh.map(pick)));            // subito disponibile nel Registro di questo browser
      var cfg = ghConfig();
      if (!cfg) return out;
      return ghSave(cfg, fresh).then(function () { out.github = true; return out; })
        .catch(function (err) { out.error = err.message || String(err); return out; });
    });
  }

  window.RegistroSync = {
    EXTRA_KEY: EXTRA_KEY, PLACEHOLDER: PLACEHOLDER, FIELDS: FIELDS,
    keyOf: keyOf, byKey: byKey, pick: pick, isPlaceholder: isPlaceholder,
    parseGarmin: parseGarmin, readExtra: readExtra, writeExtra: writeExtra,
    locIndex: locIndex, applyLocation: applyLocation, ghConfig: ghConfig, ghSave: ghSave, ghUpdateFile: ghUpdateFile,
    syncFromGarminTexts: syncFromGarminTexts
  };

  /* ---------------- Running: ogni CSV caricato aggiorna anche il Registro ---------------- */
  function notify(msg, type) { if (typeof window.toast === "function") window.toast(msg, type || "ok"); }
  function hookRunning() {
    ["handleRunCSV", "handleHikeCSV"].forEach(function (name) {
      var orig = window[name];
      if (typeof orig !== "function") return;
      window[name] = function (input) {
        var files = Array.prototype.slice.call((input && input.files) || []);   // prima che l'originale svuoti il campo
        var ret = orig.apply(this, arguments);
        if (!files.length) return ret;
        Promise.all(files.map(function (f) { return f.text(); }))
          .then(syncFromGarminTexts)
          .then(function (res) {
            if (res.none || (!res.added && !res.error)) return;                    // niente di Trail/Hiking, o già nel Registro
            var m = "Registro attività: " + res.added + (res.added === 1 ? " nuova attività" : " nuove attività");
            if (res.placeholders) m += " (" + res.placeholders + " senza località: completale dal Registro)";
            if (res.error) { notify(m + ". Salvataggio su GitHub non riuscito: " + res.error, "err"); }
            else notify(m + (res.github ? ", salvate su GitHub" : ", salvate in questo browser"));
          })
          .catch(function (e) { notify("Registro attività non aggiornato: " + (e && e.message || e), "err"); });
        return ret;
      };
    });
  }
  if (typeof window.handleRunCSV === "function") hookRunning();
})();
