/* ==========================================================================
   hub-update.js — pulsante "Aggiorna tutto da GitHub" della home.

   Cosa fa, sezione per sezione:
   - Running: scarica da GitHub lo stato (allenamenti, escursioni, Garmin, piano) e lo
     sostituisce a quello di questo dispositivo. Prima ne salva una copia di sicurezza e,
     se ci sono attività presenti solo qui (non ancora su GitHub), NON sostituisce nulla.
   - Budget: non ha una copia locale, si rilegge da GitHub a ogni apertura (serve il token).
   - Astrofoto, Attività, Registro: leggono i file del sito; qui vengono riscaricati senza cache.
   Per ogni sezione mostra la data dell'ultimo salvataggio su GitHub.
   ========================================================================== */
(function () {
  "use strict";
  var btn = document.getElementById("hub-update"), out = document.getElementById("hub-update-out");
  if (!btn || !out || !window.HUB) return;

  var RUN_KEY = "runai-v5", RUN_BACKUP = "runai-backup-hubpull";
  var FILES = {
    astrofoto: "astrofoto/data.json",
    luoghi: "attivita/data/luoghi.json",
    attivita: "attivita/data/attivita.json",
    budget: "budget/data.json",
    running: "running/data/runai-state.json"
  };

  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  function readJson(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function nIt(n, one, many) { return n + " " + (n === 1 ? one : many); }

  /* ---- token: quello di Running, altrimenti uno qualunque di Attività / Budget ---- */
  var cfgRun = readJson("runai-github") || {};
  var cfgAtt = readJson("sentieri_gh_config_v1") || {};
  var cfgBud = readJson("finanze_gh_config_v1") || {};
  var tokenRun = cfgRun.token || "";
  var anyToken = tokenRun || cfgAtt.token || cfgBud.token || "";

  var API = "https://api.github.com/repos/" + HUB.owner + "/" + HUB.repo;
  function b64utf8(b64) { var bin = atob(b64.replace(/\s/g, "")), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new TextDecoder("utf-8").decode(u); }

  /* testo di un file del repository: API con token, altrimenti raw.githubusercontent */
  function fetchRepoFile(path, token) {
    if (!token) {
      var raw = "https://raw.githubusercontent.com/" + HUB.owner + "/" + HUB.repo + "/" + HUB.branch + "/" + path + "?t=" + Date.now();
      return fetch(raw, { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); });
    }
    var h = { "Authorization": "token " + token, "Accept": "application/vnd.github+json" };
    return fetch(API + "/contents/" + path + "?ref=" + encodeURIComponent(HUB.branch), { headers: h, cache: "no-store" }).then(function (r) {
      if (r.status === 404) throw new Error("file non trovato nel repository");
      if (r.status === 401 || r.status === 403) throw new Error("token non valido o senza permessi (" + r.status + ")");
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (j) {
      if (j.content) return b64utf8(j.content);
      return fetch(API + "/git/blobs/" + j.sha, { headers: h, cache: "no-store" }).then(function (r) { return r.json(); }).then(function (b) { return b64utf8(b.content); });
    });
  }
  function lastCommit(path) {
    var h = { "Accept": "application/vnd.github+json" }; if (anyToken) h["Authorization"] = "token " + anyToken;
    return fetch(API + "/commits?path=" + encodeURIComponent(path) + "&sha=" + encodeURIComponent(HUB.branch) + "&per_page=1", { headers: h, cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (a) {
        var d = a && a[0] && a[0].commit && (a[0].commit.committer || a[0].commit.author);
        return d && d.date ? new Date(d.date).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : null;
      }).catch(function () { return null; });
  }
  function siteJson(path) {
    return fetch(path + (path.indexOf("?") > -1 ? "&" : "?") + "t=" + Date.now(), { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
  }

  /* ---------------- Running ---------------- */
  function pullRunning() {
    return fetchRepoFile(FILES.running, tokenRun || anyToken).then(function (txt) {
      var remote = JSON.parse(txt);
      if (!remote || (!remote.workouts && !remote.hikes && !remote.garminReadings)) throw new Error("il file su GitHub non è valido o è vuoto");
      remote.workouts = remote.workouts || []; remote.hikes = remote.hikes || []; remote.garminReadings = remote.garminReadings || [];
      remote.piano = remote.piano || {}; remote.pianoChecks = remote.pianoChecks || {}; remote.pianoFeedback = remote.pianoFeedback || {};
      var raw = localStorage.getItem(RUN_KEY), local = null;
      try { local = raw ? JSON.parse(raw) : null; } catch (e) {}
      var summary = nIt(remote.workouts.length, "allenamento", "allenamenti") + ", " + nIt(remote.hikes.length, "escursione", "escursioni") + ", " + remote.garminReadings.length + " letture Garmin";
      if (local) {
        var rIds = {}; remote.workouts.concat(remote.hikes).forEach(function (x) { rIds[x.id] = 1; });
        var onlyLocal = (local.workouts || []).concat(local.hikes || []).filter(function (x) { return !rIds[x.id]; });
        if (onlyLocal.length) return { st: "warn", msg: nIt(onlyLocal.length, "attività presente", "attività presenti") + " solo su questo dispositivo e non ancora su GitHub: non ho sostituito nulla. Apri Running e salva su GitHub, poi riprova." };
        if (JSON.stringify(local.workouts || []) === JSON.stringify(remote.workouts) && JSON.stringify(local.hikes || []) === JSON.stringify(remote.hikes) &&
            (local.garminReadings || []).length === remote.garminReadings.length) return { st: "ok", msg: "Già aggiornato: " + summary + "." };
        try { localStorage.setItem(RUN_BACKUP, raw); } catch (e) {}          // copia di sicurezza dei dati locali
      }
      localStorage.setItem(RUN_KEY, JSON.stringify(remote));
      Object.keys(remote.pianoChecks).forEach(function (checkId) {          // come fa Running quando carica da GitHub
        var sid = checkId.replace(/^piano-check-([^-]+)-.*$/, "$1"), key = "runai-piano-checks-" + sid;
        var ex = readJson(key) || {}; ex[checkId] = remote.pianoChecks[checkId]; localStorage.setItem(key, JSON.stringify(ex));
      });
      return { st: "ok", msg: "Aggiornato: " + summary + "." };
    });
  }

  /* ---------------- sezioni che leggono i file del sito ---------------- */
  function purgeSiteCaches() {
    if (!window.caches) return Promise.resolve();
    return caches.keys().then(function (ks) {
      return Promise.all(ks.filter(function (k) { return /^(hub-|astrofoto)/.test(k); }).map(function (k) { return caches.delete(k); }));
    }).then(function () {                                                    // riscrivo in cache la home per l'uso offline
      return Promise.all(["./", "assets/hub.css", "assets/hub.js", "assets/config.js", "assets/icon-192.png", "manifest.json"].map(function (u) { return fetch(u, { cache: "reload" }).catch(function () {}); }));
    });
  }
  function pendingRegistro() { var a = readJson("registro_extra_v1"); return a ? a.length : 0; }

  function row(name, r) { return { name: name, st: r.st, msg: r.msg }; }
  function safe(name, p) {
    return p.then(function (r) { return row(name, r); }).catch(function (e) { return row(name, { st: "err", msg: "Non riuscito: " + (e && e.message || e) + "." }); });
  }

  function run() {
    btn.disabled = true; btn.textContent = "Aggiornamento in corso…";
    out.innerHTML = '<div class="upd-box"><div class="upd-head">Aggiornamento in corso…</div></div>';
    var dates = {};
    var pDates = Promise.all(Object.keys(FILES).map(function (k) { return lastCommit(FILES[k]).then(function (d) { dates[k] = d; }); }));
    var when = function (k) { return dates[k] ? " Ultimo salvataggio su GitHub: " + dates[k] + "." : ""; };

    var pRun = pullRunning();                                                // da fare prima di leggere le date, indipendente
    var pSite = purgeSiteCaches();
    Promise.all([pDates, pSite.catch(function () {})]).then(function () {
      return Promise.all([
        safe("Astrofotografia", pSite.then(function () { return siteJson(FILES.astrofoto); }).then(function (a) {
          var c = (a.customs || []).length, m = (a.modified || []).length;
          return { st: "ok", msg: "Catalogo riscaricato: " + nIt(c, "oggetto aggiunto", "oggetti aggiunti") + ", " + nIt(m, "modificato", "modificati") + "." + when("astrofoto") };
        })),
        safe("Attività", siteJson(FILES.luoghi).then(function (l) {
          return { st: "ok", msg: "Riscaricati " + nIt(Array.isArray(l) ? l.length : 0, "luogo", "luoghi") + "." + when("luoghi") };
        })),
        safe("Registro", siteJson(FILES.attivita).then(function (a) {
          var p = pendingRegistro(), n = Array.isArray(a) ? a.length : 0;
          if (p) return { st: "warn", msg: "Riscaricate " + n + " attività. " + nIt(p, "modifica è salvata", "modifiche sono salvate") + " solo in questo browser: apri il Registro, “Importa attività da CSV” e premi “Salva ora su GitHub”." + when("attivita") };
          return { st: "ok", msg: "Riscaricate " + nIt(n, "attività", "attività") + "." + when("attivita") };
        })),
        safe("Budget", Promise.resolve({ st: cfgBud.token ? "ok" : "warn",
          msg: cfgBud.token ? "Si rilegge da GitHub a ogni apertura." + when("budget")
                            : "Token GitHub non impostato su questo dispositivo: Budget mostrerebbe i dati incorporati nel sito. Impostalo dentro Budget." + when("budget") })),
        safe("Running", pRun.then(function (r) { return { st: r.st, msg: r.msg + when("running") }; }))
      ]);
    }).then(function (rows) {
      var order = ["Astrofotografia", "Attività", "Registro", "Budget", "Running"];
      rows.sort(function (a, b) { return order.indexOf(a.name) - order.indexOf(b.name); });
      var bad = rows.filter(function (r) { return r.st !== "ok"; }).length;
      out.innerHTML = '<div class="upd-box"><div class="upd-head">' + (bad ? "Aggiornamento terminato, con avvisi" : "Tutto aggiornato") +
        ' <span class="upd-time">' + new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) + "</span></div>" +
        rows.map(function (r) { return '<div class="upd-row ' + r.st + '"><span class="upd-dot"></span><span class="upd-name">' + esc(r.name) + '</span><span class="upd-msg">' + esc(r.msg) + "</span></div>"; }).join("") + "</div>";
    }).catch(function (e) {
      out.innerHTML = '<div class="upd-box"><div class="upd-row err"><span class="upd-dot"></span><span class="upd-msg">Aggiornamento non riuscito: ' + esc(e && e.message || e) + "</span></div></div>";
    }).then(function () { btn.disabled = false; btn.textContent = "Aggiorna tutto da GitHub"; });
  }
  btn.addEventListener("click", run);
})();
