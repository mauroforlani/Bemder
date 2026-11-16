/* ==========================================================================
   hub.js — barra di navigazione comune a tutte le sezioni.

   Uso (subito dopo <body>):
     <script src="../assets/hub.js" data-app="budget"></script>
   Per la home:   <script src="assets/hub.js" data-app="home" data-root="."></script>
   ========================================================================== */
(function () {
  var me = document.currentScript;
  var app = (me && me.getAttribute('data-app')) || 'home';
  var root = (me && me.getAttribute('data-root')) || '..';

  var SECTIONS = [
    { id: 'astrofoto', label: 'Astrofoto' },
    { id: 'attivita',  label: 'Attività' },
    { id: 'registro',  label: 'Registro' },
    { id: 'budget',    label: 'Budget' },
    { id: 'running',   label: 'Running' }
  ];

  document.body.setAttribute('data-app', app);

  var nav = document.createElement('div');
  nav.className = 'hub-bar';
  nav.setAttribute('role', 'navigation');
  nav.setAttribute('aria-label', 'Sezioni del sito');

  var html = '<div class="hub-bar-in">' +
    '<a class="hub-brand" href="' + root + '/" aria-label="Home" ' + (app === 'home' ? 'aria-current="page"' : '') + '>' +
      '<span class="hub-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>' +
      '<span class="hub-brand-name">Hub</span>' +
    '</a>' +
    '<div class="hub-links">';
  SECTIONS.forEach(function (s) {
    html += '<a class="hub-link" data-s="' + s.id + '" href="' + root + '/' + s.id + '/"' +
      (s.id === app ? ' aria-current="page"' : '') + '><i class="hub-dot" aria-hidden="true"></i>' + s.label + '</a>';
  });
  html += '</div></div>';
  nav.innerHTML = html;

  document.body.insertBefore(nav, document.body.firstChild);

  /* --- app installabile (Android/Chrome): service worker + pulsante "Installa" nella home --- */
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register(root + '/sw.js').catch(function () {});
    });
  }
  var deferred = null, btn = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); deferred = e;
    var head = document.querySelector('.home-actions') || document.querySelector('.home-head');
    if (!head || btn) return;
    btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'hub-install'; btn.textContent = 'Installa l\u2019app sul telefono';
    btn.onclick = function () {
      if (!deferred) return;
      deferred.prompt();
      deferred.userChoice.then(function () { deferred = null; if (btn) btn.remove(); btn = null; });
    };
    head.appendChild(btn);
  });
  window.addEventListener('appinstalled', function () { if (btn) btn.remove(); btn = null; });
})();
