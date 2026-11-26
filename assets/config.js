/* ==========================================================================
   config.js — impostazioni condivise da tutte le sezioni del sito.

   Il repository GitHub viene rilevato da solo quando il sito è pubblicato su
   GitHub Pages (https://UTENTE.github.io/NOME-REPO/...). I valori qui sotto
   servono SOLO come ripiego (apertura da file locale, localhost, dominio
   personalizzato): se il nome del tuo repository è diverso, cambialo qui.
   ========================================================================== */
(function () {
  var FALLBACK = { owner: 'mauroforlani', repo: 'hub', branch: 'main' };

  // Cartelle delle sezioni: servono a distinguere "sito utente" da "sito progetto".
  var APPS = ['astrofoto', 'attivita', 'registro', 'webcam', 'escursioni', 'budget', 'running'];

  // Nomi dei vecchi repository separati, usati per migrare le impostazioni
  // GitHub già salvate nel browser (vedi HUB.migrateGhConfig).
  var OLD_REPOS = { astrofoto: 'astrofoto', attivita: 'attivita', budget: 'budget', running: 'running-ai', webcam: 'webcam' };

  var H = window.HUB = window.HUB || {};
  var owner = FALLBACK.owner, repo = FALLBACK.repo, detected = false;

  var m = /^([^.]+)\.github\.io$/i.exec(location.hostname);
  if (m) {
    owner = m[1];
    var first = (location.pathname.split('/')[1] || '').toLowerCase();
    // sito utente (UTENTE.github.io) oppure sito progetto (UTENTE.github.io/REPO)
    repo = (!first || APPS.indexOf(first) !== -1 || first === 'index.html')
      ? owner + '.github.io'
      : location.pathname.split('/')[1];
    detected = true;
  }

  H.owner = owner;
  H.repo = repo;
  H.branch = FALLBACK.branch;
  H.fullRepo = owner + '/' + repo;
  H.detected = detected;
  H.apps = APPS;


  /* ---- lettura dei dati da GitHub, con il sito come ripiego ----------------------------
     HUB.fetchRepoText(percorsoNelRepo, urlDelSito) -> Promise<testo>
     Ordine: API GitHub (se in qualche sezione è stato impostato un token: dati sempre
     freschi) -> raw.githubusercontent.com (con parametro anti-cache) -> file del sito.
     Fuori da GitHub Pages (localhost, file locale) legge direttamente il sito. */
  H.token = function () {
    var keys = ['runai-github', 'sentieri_gh_config_v1', 'finanze_gh_config_v1', 'ghSettings'];
    for (var i = 0; i < keys.length; i++) {
      try { var o = JSON.parse(localStorage.getItem(keys[i]) || 'null'); if (o && o.token) return o.token; } catch (e) {}
    }
    return '';
  };
  H.fetchRepoText = function (path, siteUrl) {
    function get(url, opts, ms) {
      var ctl = typeof AbortController === 'function' ? new AbortController() : null;
      var t = ctl ? setTimeout(function () { ctl.abort(); }, ms) : null;
      if (ctl) opts.signal = ctl.signal;
      return fetch(url, opts).then(function (r) {
        clearTimeout(t);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      }, function (e) { clearTimeout(t); throw e; });
    }
    function site() { return get(siteUrl + (siteUrl.indexOf('?') > -1 ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' }, 20000); }
    if (!H.detected) return site();
    var tk = H.token(), steps = [];
    if (tk) steps.push(function () {
      return get('https://api.github.com/repos/' + H.owner + '/' + H.repo + '/contents/' + path + '?ref=' + encodeURIComponent(H.branch),
        { headers: { 'Authorization': 'token ' + tk, 'Accept': 'application/vnd.github.raw+json' }, cache: 'no-store' }, 10000);
    });
    steps.push(function () {
      return get('https://raw.githubusercontent.com/' + H.owner + '/' + H.repo + '/' + H.branch + '/' + path + '?t=' + Date.now(), { cache: 'no-store' }, 10000);
    });
    steps.push(site);
    return steps.reduce(function (p, s) { return p.catch(s); }, Promise.reject(new Error('start')));
  };

  /* Percorso di un file di una sezione dentro il repository, es.
     HUB.repoPath('astrofoto', 'data.json') -> "astrofoto/data.json" */
  H.repoPath = function (app, rel) { return app + '/' + String(rel || '').replace(/^\/+/, ''); };

  /* Adatta una configurazione GitHub salvata dalle vecchie app (repository
     separati) al repository unificato. Non scrive nulla nel browser: corregge
     il valore al momento della lettura, così le app salvano sempre nel posto
     giusto. `cfg` può avere la forma {repo:"utente/nome"} oppure
     {owner:"utente", repo:"nome"}. `oldPath` è il vecchio percorso di default
     del file dati (es. "data/luoghi.json"). */
  H.migrateGhConfig = function (cfg, app, oldPath) {
    if (!cfg || typeof cfg !== 'object') return cfg;
    var out = {};
    for (var k in cfg) if (Object.prototype.hasOwnProperty.call(cfg, k)) out[k] = cfg[k];

    var split = typeof out.repo === 'string' && out.repo.indexOf('/') !== -1;
    var curName = split ? out.repo.split('/').pop() : (out.repo || '');
    var oldName = OLD_REPOS[app];
    if (curName && curName.toLowerCase() === oldName && curName.toLowerCase() !== H.repo.toLowerCase()) {
      if (split) out.repo = H.fullRepo;
      else { out.owner = H.owner; out.repo = H.repo; }
    }
    if (oldPath && out.path === oldPath) out.path = H.repoPath(app, oldPath);
    return out;
  };
})();
