/* زاد · Zad — tiny i18n loader
 * - Loads i18n/<lang>.json
 * - Replaces innerText on [data-i18n="key.path"]
 * - Replaces attribute on [data-i18n-attr="alt:hero.shot"] (attr:key,attr:key)
 * - Toggles <html lang/dir>, document.title, meta description
 * - Persists choice to localStorage
 * - Re-runs the usage widget renderer if present (window.__renderUsage)
 */
(function () {
  const SUPPORTED = ['ar', 'en'];
  const DEFAULT = 'ar';
  const KEY = 'zad_lang';

  function detect() {
    const u = new URL(location.href);
    const fromHash = u.hash.match(/^#(ar|en)$/)?.[1];
    if (fromHash) return fromHash;
    const stored = localStorage.getItem(KEY);
    if (stored && SUPPORTED.includes(stored)) return stored;
    const nav = (navigator.language || 'ar').slice(0, 2).toLowerCase();
    return SUPPORTED.includes(nav) ? nav : DEFAULT;
  }

  function get(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? null : o[k]), obj);
  }

  async function load(lang) {
    const res = await fetch(`i18n/${lang}.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`i18n: ${lang} not found`);
    return res.json();
  }

  function apply(dict, lang) {
    const meta = dict._meta || { dir: 'ltr', name: lang };
    document.documentElement.lang = lang;
    document.documentElement.dir = meta.dir;
    if (dict.doc?.title) document.title = dict.doc.title;
    if (dict.doc?.description) {
      let m = document.querySelector('meta[name="description"]');
      if (m) m.setAttribute('content', dict.doc.description);
    }

    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const v = get(dict, el.getAttribute('data-i18n'));
      if (v != null) el.textContent = v;
    });
    document.querySelectorAll('[data-i18n-html]').forEach((el) => {
      const v = get(dict, el.getAttribute('data-i18n-html'));
      if (v != null) el.innerHTML = v;
    });
    document.querySelectorAll('[data-i18n-attr]').forEach((el) => {
      el.getAttribute('data-i18n-attr')
        .split(',')
        .forEach((pair) => {
          const [attr, key] = pair.split(':').map((s) => s.trim());
          const v = get(dict, key);
          if (attr && key && v != null) el.setAttribute(attr, v);
        });
    });

    // expose for usage widget + other dynamic code
    window.__i18n = dict;
    window.__lang = lang;
    localStorage.setItem(KEY, lang);

    // notify dynamic widgets to re-render with new strings
    document.dispatchEvent(new CustomEvent('i18n:loaded', { detail: { lang, dict } }));

    // update language switcher UI
    document.querySelectorAll('[data-lang-switch]').forEach((el) => {
      el.querySelectorAll('button[data-set-lang]').forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-set-lang') === lang);
      });
      const cur = el.querySelector('[data-lang-current]');
      if (cur) cur.textContent = meta.flag + ' ' + meta.name;
    });
  }

  async function setLang(lang) {
    if (!SUPPORTED.includes(lang)) lang = DEFAULT;
    try {
      const dict = await load(lang);
      apply(dict, lang);
    } catch (e) {
      console.error(e);
    }
  }

  // expose globally
  window.zadI18n = { setLang, supported: SUPPORTED, get: () => window.__lang };

  // boot
  document.addEventListener('DOMContentLoaded', () => {
    setLang(detect());

    // wire any [data-set-lang] buttons
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-set-lang]');
      if (!b) return;
      e.preventDefault();
      setLang(b.getAttribute('data-set-lang'));
    });
  });
})();
