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
})();
