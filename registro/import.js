/* ==========================================================================
   Importazione di nuove attività nel Registro da file CSV di Garmin Connect
   (esportazioni "Hiking" e "Trail Running").

   - legge uno o più CSV, riconosce le attività già presenti (stessa data e ora)
   - propone la località (da attività con lo stesso titolo) e lascia completarla
   - salva su GitHub (attivita/data/attivita.json e .js) se in Attività è stato
     configurato il token; in ogni caso le tiene anche in questo browser
   ========================================================================== */
(function () {
  "use strict";

  var EXTRA_KEY = "registro_extra_v1";
  var GH_KEY = "sentieri_gh_config_v1";          // stessa configurazione usata da Attività
  var JSON_PATH = "attivita/data/attivita.json";
  var JS_PATH = "attivita/data/attivita.js";
  var FIELDS = ["id", "d", "h", "tipo", "t", "stato", "reg", "prov", "sg", "km", "dp", "dn", "tot", "mov",
                "qmin", "qmax", "hr", "hrmax", "cal", "tmin", "tmax", "passi", "te", "multi", "verif"];
  var TIPI_GARMIN = { "hiking": "Escursione", "trail running": "Trail Running" };
  var PLACEHOLDER = "Da verificare";

  var q = function (id) { return document.getElementById(id); };
  var h = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var keyOf = function (x) { return x.d + "|" + x.h; };

  /* ---------------- lettura CSV ---------------- */
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
  // numeri in formato italiano: "10,94" -> 10.94 ; "1.648" (migliaia) -> 1648
  function toFloat(s) {
    s = clean(s); if (s == null) return null;
    if (s.indexOf(",") > -1) s = s.replace(/\./g, "").replace(",", ".");
    var v = parseFloat(s); return isNaN(v) ? null : v;
  }
  function toInt(s) {
    s = clean(s); if (s == null) return null;
    s = s.replace(/\./g, "").replace(",", ".");
    var v = parseFloat(s); return isNaN(v) ? null : Math.round(v);
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
      for (var k = 0; k < arguments.length; k++) {
        var i = idx[arguments[k].toLowerCase()];
        if (i != null) return r[i];
      }
      return null;
    }
    var tipo = TIPI_GARMIN[(clean(g("Activity Type")) || "").toLowerCase()];
    if (!tipo) return { skip: "tipo" };
    var m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/.exec(clean(g("Date")) || "");
    if (!m) return { skip: "data" };
    var tot = toSecs(g("Time")), mov = toSecs(g("Moving Time"));
    return {
      rec: {
        id: 0, d: m[1], h: m[2] + ":" + m[3], tipo: tipo, t: (clean(g("Title")) || "").trim(),
        stato: "", reg: "", prov: "", sg: null,
        km: round(toFloat(g("Distance")), 2),
        dp: toInt(g("Ascent", "Total Ascent")), dn: toInt(g("Total Descent")),
        tot: tot, mov: mov,
        qmin: toInt(g("Min Elevation")), qmax: toInt(g("Max Elevation")),
        hr: toInt(g("Avg HR")), hrmax: toInt(g("Max HR")), cal: toInt(g("Calories")),
        tmin: null, tmax: null, passi: toInt(g("Steps")), te: round(toFloat(g("Aerobic TE")), 1),
        multi: !!(tot && mov && tot > 12 * 3600 && tot > 2 * mov), verif: false
      }
    };
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

  /* ---------------- dati locali (sovrapposti a quelli del repository) ---------------- */
  function readExtra() { try { return JSON.parse(localStorage.getItem(EXTRA_KEY) || "[]") || []; } catch (e) { return []; } }
  function writeExtra(a) { try { localStorage.setItem(EXTRA_KEY, JSON.stringify(a)); } catch (e) {} }
  function pick(x) { var o = {}; FIELDS.forEach(function (f) { o[f] = x[f] === undefined ? null : x[f]; }); return o; }

  function mergeExtra(rows) {
    var extra = readExtra(); if (!extra.length) return rows;
    var have = {}; rows.forEach(function (x) { have[keyOf(x)] = 1; });
    var keep = extra.filter(function (x) { return !have[keyOf(x)]; });
    if (keep.length !== extra.length) writeExtra(keep);      // già presenti nel repository: pulisco
    var maxId = rows.reduce(function (m, x) { return Math.max(m, x.id || 0); }, 0);
    return rows.concat(keep.map(function (x) { var c = pick(x); c.id = ++maxId; return c; }));
  }
  var origInit = window.init;
  if (typeof origInit === "function") window.init = function (rows) { return origInit(mergeExtra(rows)); };

  /* ---------------- località ---------------- */
  function locIndex() {
    var byTitle = {}, byLoc = {}, stati = {}, regs = {};
    DATA.slice().sort(function (a, b) { return keyOf(a) < keyOf(b) ? -1 : 1; }).forEach(function (x) {
      var loc = x.sg ? x.prov + " (" + x.sg + ")" : x.prov;
      var info = { stato: x.stato, reg: x.reg, loc: loc };
      byTitle[(x.t || "").toLowerCase()] = info;
      byLoc[loc] = info; stati[x.stato] = 1; regs[x.reg] = 1;
    });
    return { byTitle: byTitle, byLoc: byLoc, stati: Object.keys(stati).sort(), regs: Object.keys(regs).sort(), locs: Object.keys(byLoc).sort() };
  }

  /* ---------------- finestra ---------------- */
  var st = { items: [], dup: 0, skipped: 0, files: 0, idx: null, saving: false, done: false };

  function ensureModal() {
    if (q("imp-modal")) return;
    var el = document.createElement("div");
    el.className = "imp-overlay"; el.id = "imp-modal"; el.hidden = true;
    el.innerHTML = '<div class="imp-box" role="dialog" aria-modal="true" aria-labelledby="imp-title"><button class="imp-x" id="imp-x" aria-label="Chiudi">✕</button><div id="imp-body"></div></div>';
    document.body.appendChild(el);
    el.addEventListener("mousedown", function (e) { if (e.target === el && !st.saving) close(); });
    q("imp-x").onclick = function () { if (!st.saving) close(); };
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !el.hidden && !st.saving) close(); });
  }
  function open() {
    ensureModal();
    st = { items: [], dup: 0, skipped: 0, files: 0, idx: locIndex(), saving: false, done: false };
    renderStart();
    q("imp-modal").hidden = false;
  }
  function close() { q("imp-modal").hidden = true; }

  function ghConfig() {
    try {
      var c = JSON.parse(localStorage.getItem(GH_KEY) || "null");
      if (!c) return null;
      c = window.HUB && HUB.migrateGhConfig ? HUB.migrateGhConfig(c, "attivita", "data/luoghi.json") : c;
      return (c.token && c.repo && c.branch) ? c : null;
    } catch (e) { return null; }
  }
  function destNote() {
    var c = ghConfig();
    return c ? "Le attività verranno salvate nel repository <b>" + h(c.repo) + "</b> (attivita/data/attivita.json)."
             : "GitHub non è configurato: le attività resteranno solo in questo browser. Per salvarle nel repository imposta il token nella sezione Attività (pulsante GitHub).";
  }

  function renderStart() {
    q("imp-body").innerHTML =
      '<h3 id="imp-title">Importa attività da CSV</h3>' +
      '<p class="imp-sub">Carica i file esportati da Garmin Connect per Hiking e Trail Running (anche tutti e due insieme). Le attività già presenti, con la stessa data e ora, vengono riconosciute e saltate.</p>' +
      '<label class="imp-drop" id="imp-drop"><input type="file" id="imp-file" accept=".csv,text/csv" multiple><b>Scegli i file CSV</b> oppure trascinali qui</label>' +
      '<div id="imp-result"></div>';
    var drop = q("imp-drop"), inp = q("imp-file");
    inp.onchange = function () { handleFiles(inp.files); };
    ["dragenter", "dragover"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("over"); }); });
    ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("over"); }); });
    drop.addEventListener("drop", function (e) { handleFiles(e.dataTransfer.files); });
  }

  function handleFiles(files) {
    files = Array.prototype.slice.call(files || []);
    if (!files.length) return;
    var existing = {}; DATA.forEach(function (x) { existing[keyOf(x)] = 1; });
    var seen = {}, items = [], dup = 0, skipped = 0, bad = [], n = 0;
    Promise.all(files.map(function (f) { return f.text().then(function (t) { return { name: f.name, text: t }; }); })).then(function (list) {
      list.forEach(function (f) {
        var p = parseGarmin(f.text);
        if (p.bad) { bad.push(f.name); return; }
        n++; skipped += p.skipped;
        p.recs.forEach(function (r) {
          var k = keyOf(r);
          if (existing[k] || seen[k]) { dup++; return; }
          seen[k] = 1;
          var g = st.idx.byTitle[r.t.toLowerCase()];
          items.push({ rec: r, on: true, stato: g ? g.stato : "", reg: g ? g.reg : "", loc: g ? g.loc : "", guessed: !!g });
        });
      });
      items.sort(function (a, b) { return keyOf(a.rec) < keyOf(b.rec) ? 1 : -1; });
      st.items = items; st.dup = dup; st.skipped = skipped; st.files = n;
      renderPreview(bad);
    });
  }

  function renderPreview(bad) {
    var items = st.items;
    var msg = bad && bad.length ? '<div class="imp-msg err">File non riconosciuto come esportazione Garmin: ' + bad.map(h).join(", ") + '</div>' : "";
    var sum = '<div class="imp-sum"><span>File letti: <b>' + st.files + '</b></span><span>Nuove attività: <b>' + items.length + '</b></span><span>Già presenti: <b>' + st.dup + '</b></span>' +
      (st.skipped ? '<span>Ignorate (tipo non supportato): <b>' + st.skipped + '</b></span>' : "") + "</div>";
    if (!items.length) {
      q("imp-result").innerHTML = msg + sum + '<div class="imp-msg">Non ci sono attività nuove da aggiungere.</div>' +
        '<div class="imp-foot"><button class="btn" id="imp-back">Scegli altri file</button><button class="btn dark" id="imp-close">Chiudi</button></div>';
      q("imp-back").onclick = renderStart; q("imp-close").onclick = close; return;
    }
    var ix = st.idx;
    var dl = function (id, arr) { return '<datalist id="' + id + '">' + arr.map(function (v) { return '<option value="' + h(v) + '">'; }).join("") + "</datalist>"; };
    var rows = items.map(function (it, i) {
      var r = it.rec, tag = r.tipo === "Escursione" ? "esc" : "trail";
      return '<tr data-i="' + i + '"><td><input type="checkbox" data-f="on" ' + (it.on ? "checked" : "") + ' aria-label="Includi"></td>' +
        "<td>" + r.d.split("-").reverse().join("/") + " " + r.h + '</td><td><span class="tag ' + tag + '">' + r.tipo + '</span></td>' +
        '<td class="t" title="' + h(r.t) + '">' + h(r.t) + '</td><td class="n">' + (r.km == null ? "—" : r.km.toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 2 })) + '</td>' +
        '<td class="n">' + (r.dp == null ? "—" : r.dp.toLocaleString("it-IT")) + "</td>" +
        '<td><input class="imp-in" data-f="stato" list="imp-dl-stato" value="' + h(it.stato) + '" placeholder="Stato"></td>' +
        '<td><input class="imp-in" data-f="reg" list="imp-dl-reg" value="' + h(it.reg) + '" placeholder="Regione"></td>' +
        '<td><input class="imp-in loc" data-f="loc" list="imp-dl-loc" value="' + h(it.loc) + '" placeholder="Provincia / zona"></td></tr>';
    }).join("");
    q("imp-result").innerHTML = msg + sum +
      '<p class="imp-sub">La località è già compilata quando il titolo coincide con un’attività presente. Completa quelle vuote (scegli dall’elenco oppure scrivi, ad esempio <i>Bergamo (BG)</i>): se restano vuote l’attività viene segnata “Da verificare”.</p>' +
      '<div class="imp-tbl-wrap"><table class="imp-tbl"><thead><tr><th></th><th>Data</th><th>Tipo</th><th>Titolo</th><th class="n">Km</th><th class="n">D+</th><th>Stato</th><th>Regione</th><th>Provincia / zona</th></tr></thead><tbody id="imp-tb">' + rows + "</tbody></table></div>" +
      dl("imp-dl-stato", ix.stati) + dl("imp-dl-reg", ix.regs) + dl("imp-dl-loc", ix.locs) +
      '<div id="imp-status"></div>' +
      '<div class="imp-foot"><span class="grow">' + destNote() + '</span><button class="btn" id="imp-back">Indietro</button><button class="btn dark" id="imp-go"></button></div>';
    markMissing(); updateGo();
    q("imp-back").onclick = renderStart;
    q("imp-go").onclick = save;
    var tb = q("imp-tb");
    tb.addEventListener("input", onEdit); tb.addEventListener("change", onEdit);
  }

  function onEdit(e) {
    var el = e.target, tr = el.closest("tr"); if (!tr) return;
    var it = st.items[+tr.dataset.i], f = el.dataset.f;
    if (f === "on") { it.on = el.checked; tr.classList.toggle("off", !it.on); updateGo(); return; }
    it[f] = el.value;
    if (f === "loc") {                                   // scelta di una località nota: compila stato e regione
      var info = st.idx.byLoc[el.value];
      if (info) {
        it.stato = info.stato; it.reg = info.reg;
        tr.querySelector('[data-f="stato"]').value = it.stato; tr.querySelector('[data-f="reg"]').value = it.reg;
      }
    }
    markMissing();
  }
  function markMissing() {
    document.querySelectorAll("#imp-tb tr").forEach(function (tr) {
      var it = st.items[+tr.dataset.i];
      ["stato", "reg", "loc"].forEach(function (f) { tr.querySelector('[data-f="' + f + '"]').classList.toggle("miss", it.on && !String(it[f] || "").trim()); });
    });
  }
  function updateGo() {
    var n = st.items.filter(function (i) { return i.on; }).length, b = q("imp-go");
    if (!b) return;
    b.textContent = "Aggiungi " + n + " attività"; b.disabled = !n || st.saving;
    markMissing();
  }

  function finalRecord(it) {
    var r = JSON.parse(JSON.stringify(it.rec));
    var stato = (it.stato || "").trim(), reg = (it.reg || "").trim(), loc = (it.loc || "").trim();
    var info = st.idx.byLoc[loc];
    if (info) { if (!stato) stato = info.stato; if (!reg) reg = info.reg; }
    var m = /^(.*\S)\s*\(([A-Za-z]{2})\)$/.exec(loc);
    r.prov = m ? m[1] : loc; r.sg = m ? m[2].toUpperCase() : null;
    r.verif = !(stato && reg && loc);
    r.stato = stato || PLACEHOLDER; r.reg = reg || PLACEHOLDER; r.prov = r.prov || PLACEHOLDER;
    return r;
  }

  /* ---------------- salvataggio ---------------- */
  function setStatus(html, cls) { var s = q("imp-status"); if (s) s.innerHTML = '<div class="imp-msg ' + (cls || "") + '">' + html + "</div>"; }
  function sortRenumber(arr) {
    arr.sort(function (a, b) { return keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0; });
    arr.forEach(function (x, i) { x.id = i + 1; });
    return arr;
  }
  function b64dec(b64) { var bin = atob(b64.replace(/\s/g, "")), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new TextDecoder("utf-8").decode(u).replace(/^\uFEFF/, ""); }
  function b64enc(s) { var u = new TextEncoder().encode(s), bin = ""; for (var i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(bin); }
  var encPath = function (p) { return p.split("/").map(encodeURIComponent).join("/"); };

  function ghSave(cfg, recs) {
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
    var msg = "Registro: aggiunte " + recs.length + (recs.length === 1 ? " attività" : " attività");
    return get(JSON_PATH).then(function (cur) {
      if (!cur) throw new Error("File " + JSON_PATH + " non trovato nel repository");
      var arr = JSON.parse(cur.text), have = {}; arr.forEach(function (x) { have[keyOf(x)] = 1; });
      var add = recs.filter(function (x) { return !have[keyOf(x)]; });
      if (!add.length) return 0;
      add.forEach(function (x) { arr.push(pick(x)); });
      var text = JSON.stringify(sortRenumber(arr));
      return put(JSON_PATH, text, cur.sha, msg).then(function () { return get(JS_PATH); }).then(function (js) {
        return put(JS_PATH, "window.ATTIVITA=" + text + ";", js ? js.sha : null, msg);
      }).then(function () { return add.length; });
    });
  }

  function save() {
    if (st.saving) return;
    var chosen = st.items.filter(function (i) { return i.on; });
    if (!chosen.length) return;
    var recs = chosen.map(finalRecord);
    st.saving = true; q("imp-go").disabled = true; q("imp-back").disabled = true;

    // 1) in questo browser e nella pagina, subito
    var extra = readExtra(), have = {}; extra.forEach(function (x) { have[keyOf(x)] = 1; });
    recs.forEach(function (r) { if (!have[keyOf(r)]) extra.push(pick(r)); });
    writeExtra(extra);
    var maxId = DATA.reduce(function (m, x) { return Math.max(m, x.id || 0); }, 0);
    var fresh = recs.map(function (r) { var c = pick(r); c.id = ++maxId; return c; });
    origInit(DATA.concat(fresh));
    document.querySelectorAll("#f-anni .chip").forEach(function (c) { c.classList.toggle("on", S.anni.has(+c.dataset.y)); });

    // 2) nel repository, se configurato
    var cfg = ghConfig();
    if (!cfg) { finish(recs.length, false, null); return; }
    setStatus("Salvataggio su GitHub in corso…");
    ghSave(cfg, recs).then(function (n) { finish(recs.length, true, null, n); })
      .catch(function (err) { finish(recs.length, false, err.message || String(err)); });
  }

  function finish(n, savedGh, error, addedGh) {
    st.saving = false; st.done = true;
    var txt = "<b>" + n + (n === 1 ? " attività aggiunta" : " attività aggiunte") + "</b> al registro.";
    var cls = "ok";
    if (savedGh) txt += " Salvate anche nel repository" + (addedGh === 0 ? " (erano già presenti)" : "") + ": il sito online si aggiorna entro un paio di minuti.";
    else if (error) { cls = "err"; txt += "<br>Non sono riuscito a salvarle su GitHub: " + h(error) + ". Restano in questo browser: puoi riprovare importando di nuovo gli stessi file, oppure scaricare il file aggiornato."; }
    else txt += " Per ora sono salvate solo in questo browser.";
    setStatus(txt, cls);
    var foot = document.querySelector("#imp-result .imp-foot");
    if (foot) foot.innerHTML = '<span class="grow"><button class="imp-link" id="imp-dl">Scarica attivita.json aggiornato</button></span><button class="btn dark" id="imp-close">Chiudi</button>';
    var d = q("imp-dl"); if (d) d.onclick = downloadJson;
    var c = q("imp-close"); if (c) c.onclick = close;
  }

  function downloadJson() {
    var arr = sortRenumber(DATA.map(pick));
    var blob = new Blob([JSON.stringify(arr)], { type: "application/json" });
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "attivita.json"; a.click(); URL.revokeObjectURL(a.href);
  }

  /* ---------------- collegamento al pulsante ---------------- */
  document.addEventListener("DOMContentLoaded", function () { var b = q("btn-import"); if (b) b.onclick = open; });
  window.RegistroImport = { parseGarmin: parseGarmin };   // per verifiche
})();
