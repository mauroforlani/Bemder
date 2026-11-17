/* Running: all'apertura legge lo stato da GitHub (ripiego: file del sito) e lo applica.
   Non sostituisce nulla se ci sono attività presenti solo su questo dispositivo. */
(function () {
  "use strict";
  if (!window.HUB || !HUB.fetchRepoText || typeof loadState !== "function") return;
  var BACKUP = "runai-backup-hubpull";

  HUB.fetchRepoText("running/data/runai-state.json", "data/runai-state.json").then(function (txt) {
    var loaded = JSON.parse(txt);
    if (!loaded || (!loaded.workouts && !loaded.hikes && !loaded.garminReadings)) return;

    var rIds = {};
    (loaded.workouts || []).concat(loaded.hikes || []).forEach(function (x) { rIds[x.id] = 1; });
    var onlyLocal = state.workouts.concat(state.hikes).filter(function (x) { return !rIds[x.id]; });
    if (onlyLocal.length) {
      toast("Running: " + onlyLocal.length + (onlyLocal.length === 1 ? " attività è" : " attività sono") + " solo su questo dispositivo, non ancora su GitHub: ho mantenuto i dati locali", "err");
      return;
    }
    var newHikes = normalizeDates(loaded.hikes || []);
    if (JSON.stringify(state.workouts) === JSON.stringify(loaded.workouts || []) &&
        JSON.stringify(state.hikes) === JSON.stringify(newHikes) &&
        (state.garminReadings || []).length === (loaded.garminReadings || []).length) return;   // già aggiornato

    try { localStorage.setItem(BACKUP, localStorage.getItem(DB_KEY) || ""); } catch (e) {}       // copia di sicurezza
    state = loaded;
    state.hikes = newHikes;
    state.workouts = state.workouts || [];
    state.garminReadings = state.garminReadings || [];
    state.piano = state.piano || {};
    state.pianoChecks = state.pianoChecks || {};
    state.pianoFeedback = state.pianoFeedback || {};
    migrateRunTypes(); migrateElevGain();
    Object.entries(state.pianoChecks).forEach(function (kv) {
      var sid = kv[0].replace(/^piano-check-([^-]+)-.*$/, "$1"), key = "runai-piano-checks-" + sid;
      var ex = JSON.parse(localStorage.getItem(key) || "{}"); ex[kv[0]] = kv[1]; localStorage.setItem(key, JSON.stringify(ex));
    });
    if (!window._pianoData) window._pianoData = {};
    Object.entries(state.piano).forEach(function (kv) { window._pianoData[kv[0]] = (kv[1] && kv[1].settimane) || []; });
    saveState();                                       // solo in locale: non scrive su GitHub
    SECTIONS.forEach(function (s) { var el = document.getElementById("page-" + s); if (el && el.style.display !== "none") renderSection(s); });
    renderHome(); renderHeaderBtns();
    toast("Running aggiornato da GitHub: " + state.workouts.length + " allenamenti, " + state.hikes.length + " escursioni", "ok");
  }).catch(function (e) { console.warn("Running: aggiornamento da GitHub non riuscito", e); });
})();
