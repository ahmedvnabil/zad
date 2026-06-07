/* زاد · custom events for Umami
 * Loads after umami's script.js. Silently no-ops if umami isn't ready.
 * Add data-track-source="<name>" to a link/button to label the click location.
 */
(function () {
  function t(name, data) {
    if (!window.umami || !window.umami.track) return;
    try { data ? window.umami.track(name, data) : window.umami.track(name); }
    catch (_) {}
  }
  // expose so other inline scripts (i18n.js, usage widget) can call it
  window.zadTrack = t;

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    // 1) any link to the live demo
    document.querySelectorAll('a[href*="demo.zad.tools"]').forEach(function (el) {
      el.addEventListener('click', function () {
        t('demo_click', { source: el.getAttribute('data-track-source') || 'unknown' });
      });
    });

    // 2) any link to the GitHub repo
    document.querySelectorAll('a[href*="github.com/ahmedvnabil/zad"]').forEach(function (el) {
      el.addEventListener('click', function () {
        t('github_click', { source: el.getAttribute('data-track-source') || 'unknown' });
      });
    });

    // 3) usage widget — code-language tabs
    document.querySelectorAll('#utabs button').forEach(function (b) {
      b.addEventListener('click', function () {
        t('usage_lang', { lang: b.getAttribute('data-lang') });
      });
    });

    // 4) usage widget — .env toggle
    var envEl = document.getElementById('useenv');
    if (envEl) {
      envEl.addEventListener('change', function () {
        t('usage_env_toggle', { enabled: envEl.checked });
      });
    }

    // 5) usage widget — copy button
    var copyBtn = document.getElementById('ucopy');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        var active = document.querySelector('#utabs button.active');
        t('usage_copy', {
          lang: active ? active.getAttribute('data-lang') : 'unknown',
          env: envEl && envEl.checked ? 'env' : 'inline',
        });
      });
    }
  });
})();
