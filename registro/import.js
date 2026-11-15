/* ==========================================================================
   Registro: importazione di nuove attività da CSV Garmin e completamento delle
   località mancanti. La logica comune (lettura CSV, salvataggio locale e su
   GitHub) sta in ../assets/registro-sync.js, usata anche da Running.
   ========================================================================== */
(function () {
  "use strict";
  var RS = window.RegistroSync;
  if (!RS) { console.warn("registro-sync.js non caricato"); return; }

  var PLACEHOLDER = RS.PLACEHOLDER, keyOf = RS.keyOf, pick = RS.pick;
  var LOCF = ["stato", "reg", "prov", "sg", "verif"];
  var q = function (id) { return document.getElementById(id); };
  var h = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };

  /* ---------------- dati locali sovrapposti a quelli del repository ---------------- */
  function mergeExtra(rows) {
    var extra = RS.readExtra(); if (!extra.length) return rows;
    var pos = {}; rows.forEach(function (x, i) { pos[keyOf(x)] = i; });
    var keep = [], adds = [];
    extra.forEach(function (x) {
      var i = pos[keyOf(x)];
      if (x.upd) {                                         // correzione di località su un'attività del repository
        if (i == null) return;
        if (RS.isPlaceholder(rows[i])) { LOCF.forEach(function (f) { rows[i][f] = x[f]; }); keep.push(x); }
        return;
      }
      if (i != null) {                                     // già nel repository
        if (RS.isPlaceholder(rows[i]) && !RS.isPlaceholder(x)) { LOCF.forEach(function (f) { rows[i][f] = x[f]; }); keep.push(x); }
        return;
      }
      keep.push(x); adds.push(x);
    });
    if (keep.length !== extra.length) RS.writeExtra(keep);  // ripulisco ciò che il repository contiene già
    var maxId = rows.reduce(function (m, x) { return Math.max(m, x.id || 0); }, 0);
    return rows.concat(adds.map(function (x) { var c = pick(x); c.id = ++maxId; return c; }));
  }
  var origInit = window.init;
  if (typeof origInit === "function") window.init = function (rows) { var r = origInit(mergeExtra(rows)); refreshBanner(); return r; };

  function refreshBanner() {
    var bar = document.querySelector(".imp-bar"); if (!bar) return;
    var n = DATA.filter(RS.isPlaceholder).length, b = q("btn-complete");
    if (!n) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement("button"); b.className = "btn"; b.id = "btn-complete"; b.type = "button"; b.onclick = openComplete; bar.insertBefore(b, bar.querySelector(".imp-hint")); }
    b.textContent = "Completa località (" + n + ")";
  }

  /* ---------------- località ---------------- */
  function locIndexUi() {
    var byLoc = {}, stati = {}, regs = {};
    DATA.forEach(function (x) {
      if (RS.isPlaceholder(x)) return;
      var loc = x.sg ? x.prov + " (" + x.sg + ")" : x.prov;
      byLoc[loc] = { stato: x.stato, reg: x.reg, loc: loc }; stati[x.stato] = 1; regs[x.reg] = 1;
    });
    return { byTitle: RS.locIndex(DATA), byLoc: byLoc, stati: Object.keys(stati).sort(), regs: Object.keys(regs).sort(), locs: Object.keys(byLoc).sort() };
  }
  function locOf(info) { return info ? (info.sg ? info.prov + " (" + info.sg + ")" : info.prov) : ""; }
  function resolveLocation(it) {
    var stato = (it.stato || "").trim(), reg = (it.reg || "").trim(), loc = (it.loc || "").trim();
    var info = st.idx.byLoc[loc];
    if (info) { if (!stato) stato = info.stato; if (!reg) reg = info.reg; }
    var m = /^(.*\S)\s*\(([A-Za-z]{2})\)$/.exec(loc);
    var prov = m ? m[1] : loc, sg = m ? m[2].toUpperCase() : null;
    var ok = !!(stato && reg && loc);
    return { stato: stato || PLACEHOLDER, reg: reg || PLACEHOLDER, prov: prov || PLACEHOLDER, sg: sg, verif: !ok };
  }

  /* ---------------- finestra ---------------- */
  var st = { items: [], dup: 0, skipped: 0, files: 0, idx: null, saving: false, mode: "import" };

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
    st = { items: [], dup: 0, skipped: 0, files: 0, idx: locIndexUi(), saving: false, mode: "import" };
    renderStart(); q("imp-modal").hidden = false;
  }
  function close() { q("imp-modal").hidden = true; }

  function destNote() {
    var c = RS.ghConfig();
    return c ? "Verranno salvate nel repository <b>" + h(c.repo) + "</b> (attivita/data/attivita.json)."
             : "GitHub non è configurato: i dati resteranno solo in questo browser. Per salvarli nel repository imposta il token nella sezione Attività (pulsante GitHub).";
  }
  function setStatus(html, cls) { var s = q("imp-status"); if (s) s.innerHTML = '<div class="imp-msg ' + (cls || "") + '">' + html + "</div>"; }

  // attività aggiunte/corrette in questo browser ma non ancora nel repository
  function pendingBox() {
    var n = RS.readExtra().length;
    if (!n || !RS.ghConfig()) return '<div id="imp-status"></div>';
    return '<div id="imp-status"><div class="imp-msg">Ci sono <b>' + n + (n === 1 ? " modifica salvata" : " modifiche salvate") + '</b> solo in questo browser. ' +
      '<button class="imp-link" id="imp-sync">Salva ora su GitHub</button></div></div>';
  }
  function syncPending() {
    var cfg = RS.ghConfig(), extra = RS.readExtra();
    if (!cfg || !extra.length || st.saving) return;
    var recs = extra.filter(function (x) { return !x.upd; }), ups = extra.filter(function (x) { return x.upd; });
    st.saving = true; setStatus("Salvataggio su GitHub in corso…");
    RS.ghSave(cfg, recs, ups).then(function (r) {
      st.saving = false;
      setStatus("<b>Fatto.</b> " + (r.added + r.updated === 0 ? "Era già tutto nel repository." : "Dati salvati nel repository") + ": il sito online si aggiorna entro un paio di minuti.", "ok");
    }).catch(function (err) { st.saving = false; setStatus("Salvataggio su GitHub non riuscito: " + h(err.message || String(err)), "err"); });
  }

  function renderStart() {
    st.mode = "import";
    q("imp-body").innerHTML =
      '<h3 id="imp-title">Importa attività da CSV</h3>' +
      '<p class="imp-sub">Carica i file esportati da Garmin Connect per Hiking e Trail Running (anche tutti e due insieme). Le attività già presenti, con la stessa data e ora, vengono riconosciute e saltate. Le attività caricate nella sezione Running arrivano qui in automatico.</p>' +
      pendingBox() +
      '<label class="imp-drop" id="imp-drop"><input type="file" id="imp-file" accept=".csv,text/csv" multiple><b>Scegli i file CSV</b> oppure trascinali qui</label>' +
      '<div id="imp-result"></div>';
    var sy = q("imp-sync"); if (sy) sy.onclick = syncPending;
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
        var p = RS.parseGarmin(f.text);
        if (p.bad) { bad.push(f.name); return; }
        n++; skipped += p.skipped;
        p.recs.forEach(function (r) {
          var k = keyOf(r);
          if (existing[k] || seen[k]) { dup++; return; }
          seen[k] = 1;
          var g = st.idx.byTitle[r.t.toLowerCase()];
          items.push({ rec: r, on: true, stato: g ? g.stato : "", reg: g ? g.reg : "", loc: locOf(g), guessed: !!g });
        });
      });
      items.sort(function (a, b) { return keyOf(a.rec) < keyOf(b.rec) ? 1 : -1; });
      st.items = items; st.dup = dup; st.skipped = skipped; st.files = n;
      renderPreview(bad);
    });
  }

  function tableHtml(items) {
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
    return '<div class="imp-tbl-wrap"><table class="imp-tbl"><thead><tr><th></th><th>Data</th><th>Tipo</th><th>Titolo</th><th class="n">Km</th><th class="n">D+</th><th>Stato</th><th>Regione</th><th>Provincia / zona</th></tr></thead><tbody id="imp-tb">' + rows + "</tbody></table></div>" +
      dl("imp-dl-stato", ix.stati) + dl("imp-dl-reg", ix.regs) + dl("imp-dl-loc", ix.locs);
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
    q("imp-result").innerHTML = msg + sum +
      '<p class="imp-sub">La località è già compilata quando il titolo coincide con un’attività presente. Completa quelle vuote (scegli dall’elenco oppure scrivi, ad esempio <i>Bergamo (BG)</i>): se restano vuote l’attività viene segnata “Da verificare” e potrai completarla in seguito.</p>' +
      tableHtml(items) + '<div id="imp-status"></div>' +
      '<div class="imp-foot"><span class="grow">' + destNote() + '</span><button class="btn" id="imp-back">Indietro</button><button class="btn dark" id="imp-go"></button></div>';
    wireTable(function (n) { return "Aggiungi " + n + " attività"; }); q("imp-back").onclick = renderStart; q("imp-go").onclick = save;
  }

  function wireTable(label) {
    st.label = label; markMissing(); updateGo();
    var tb = q("imp-tb"); tb.addEventListener("input", onEdit); tb.addEventListener("change", onEdit);
  }
  function onEdit(e) {
    var el = e.target, tr = el.closest("tr"); if (!tr) return;
    var it = st.items[+tr.dataset.i], f = el.dataset.f;
    if (f === "on") { it.on = el.checked; tr.classList.toggle("off", !it.on); updateGo(); return; }
    it[f] = el.value;
    if (f === "loc") {
      var info = st.idx.byLoc[el.value];
      if (info) { it.stato = info.stato; it.reg = info.reg; tr.querySelector('[data-f="stato"]').value = it.stato; tr.querySelector('[data-f="reg"]').value = it.reg; }
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
    b.textContent = st.label(n); b.disabled = !n || st.saving; markMissing();
  }

  /* ---------------- salvataggio nuove attività ---------------- */
  function save() {
    if (st.saving) return;
    var chosen = st.items.filter(function (i) { return i.on; });
    if (!chosen.length) return;
    var recs = chosen.map(function (it) { var r = JSON.parse(JSON.stringify(it.rec)); var l = resolveLocation(it); LOCF.forEach(function (f) { r[f] = l[f]; }); return r; });
    st.saving = true; q("imp-go").disabled = true; q("imp-back").disabled = true;

    var extra = RS.readExtra(), have = {}; extra.forEach(function (x) { if (!x.upd) have[keyOf(x)] = 1; });
    recs.forEach(function (r) { if (!have[keyOf(r)]) extra.push(pick(r)); });
    RS.writeExtra(extra);
    var maxId = DATA.reduce(function (m, x) { return Math.max(m, x.id || 0); }, 0);
    var fresh = recs.map(function (r) { var c = pick(r); c.id = ++maxId; return c; });
    origInit(DATA.concat(fresh)); keepChips();

    var cfg = RS.ghConfig();
    if (!cfg) { finish(recs.length + (recs.length === 1 ? " attività aggiunta" : " attività aggiunte"), false, null); return; }
    setStatus("Salvataggio su GitHub in corso…");
    RS.ghSave(cfg, recs).then(function (r) { finish(recs.length + (recs.length === 1 ? " attività aggiunta" : " attività aggiunte"), true, null, r.added + r.updated); })
      .catch(function (err) { finish(recs.length + (recs.length === 1 ? " attività aggiunta" : " attività aggiunte"), false, err.message || String(err)); });
  }
  function keepChips() {
    document.querySelectorAll("#f-anni .chip").forEach(function (c) { c.classList.toggle("on", S.anni.has(+c.dataset.y)); });
    refreshBanner();
  }
  function finish(what, savedGh, error, changedGh) {
    st.saving = false;
    var txt = "<b>" + what + "</b> al registro.", cls = "ok";
    if (savedGh) txt += " Salvate anche nel repository" + (changedGh === 0 ? " (erano già presenti)" : "") + ": il sito online si aggiorna entro un paio di minuti.";
    else if (error) { cls = "err"; txt += "<br>Non sono riuscito a salvare su GitHub: " + h(error) + ". Restano in questo browser: dopo aver sistemato il token, riapri “Importa attività da CSV” e premi “Salva ora su GitHub”. In alternativa scarica il file aggiornato."; }
    else txt += " Per ora sono salvate solo in questo browser.";
    setStatus(txt, cls);
    var foot = document.querySelector("#imp-result .imp-foot, #imp-body .imp-foot");
    if (foot) foot.innerHTML = '<span class="grow"><button class="imp-link" id="imp-dl">Scarica attivita.json aggiornato</button></span><button class="btn dark" id="imp-close">Chiudi</button>';
    var d = q("imp-dl"); if (d) d.onclick = downloadJson;
    var c = q("imp-close"); if (c) c.onclick = close;
  }
  function downloadJson() {
    var arr = DATA.map(pick).sort(RS.byKey); arr.forEach(function (x, i) { x.id = i + 1; });
    var blob = new Blob([JSON.stringify(arr)], { type: "application/json" });
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "attivita.json"; a.click(); URL.revokeObjectURL(a.href);
  }

  /* ---------------- completamento delle località mancanti ---------------- */
  function openComplete() {
    ensureModal();
    st = { items: [], dup: 0, skipped: 0, files: 0, idx: locIndexUi(), saving: false, mode: "complete" };
    var todo = DATA.filter(RS.isPlaceholder).sort(function (a, b) { return keyOf(a) < keyOf(b) ? 1 : -1; });
    st.items = todo.map(function (x) {
      var g = st.idx.byTitle[(x.t || "").toLowerCase()];
      return { rec: x, on: true, stato: g ? g.stato : "", reg: g ? g.reg : "", loc: locOf(g) };
    });
    q("imp-body").innerHTML =
      '<h3 id="imp-title">Completa le località</h3>' +
      '<p class="imp-sub">Queste attività sono state aggiunte senza località (ad esempio caricate da Running). Scegli la località dall’elenco o scrivila, ad esempio <i>Bergamo (BG)</i>; quelle che lasci vuote restano “Da verificare”.</p>' +
      '<div id="imp-result">' + tableHtml(st.items) + '<div id="imp-status"></div>' +
      '<div class="imp-foot"><span class="grow">' + destNote() + '</span><button class="btn" id="imp-back">Annulla</button><button class="btn dark" id="imp-go"></button></div></div>';
    wireTable(function (n) { return "Salva " + n + (n === 1 ? " località" : " località"); });
    q("imp-back").onclick = close; q("imp-go").onclick = saveComplete;
    q("imp-modal").hidden = false;
  }
  function saveComplete() {
    if (st.saving) return;
    var chosen = st.items.filter(function (i) { return i.on && String(i.loc || "").trim(); });
    if (!chosen.length) { setStatus("Compila la località di almeno un’attività.", "err"); return; }
    var ups = chosen.map(function (it) { var l = resolveLocation(it); return { d: it.rec.d, h: it.rec.h, stato: l.stato, reg: l.reg, prov: l.prov, sg: l.sg, verif: l.verif }; });
    st.saving = true; q("imp-go").disabled = true; q("imp-back").disabled = true;

    var extra = RS.readExtra();
    ups.forEach(function (u) {
      var k = keyOf(u), e = null;
      extra.forEach(function (x) { if (keyOf(x) === k) e = x; });
      if (!e) { e = { d: u.d, h: u.h, upd: 1 }; extra.push(e); }
      LOCF.forEach(function (f) { e[f] = u[f]; });
    });
    RS.writeExtra(extra);
    ups.forEach(function (u) { DATA.forEach(function (x) { if (keyOf(x) === keyOf(u)) LOCF.forEach(function (f) { x[f] = u[f]; }); }); });
    origInit(DATA); keepChips();

    var cfg = RS.ghConfig(), what = ups.length + (ups.length === 1 ? " località salvata" : " località salvate");
    if (!cfg) { finish(what, false, null); return; }
    setStatus("Salvataggio su GitHub in corso…");
    var full = DATA.filter(function (x) { return ups.some(function (u) { return keyOf(u) === keyOf(x); }); }).map(pick);
    RS.ghSave(cfg, full, ups).then(function (r) { finish(what, true, null, r.added + r.updated); })
      .catch(function (err) { finish(what, false, err.message || String(err)); });
  }

  /* ---------------- collegamento ---------------- */
  document.addEventListener("DOMContentLoaded", function () { var b = q("btn-import"); if (b) b.onclick = open; });
  window.RegistroImport = { parseGarmin: RS.parseGarmin };
})();
