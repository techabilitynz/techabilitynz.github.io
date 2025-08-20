/* Monetag controller — Tech Ability
   - Never runs on /admin/ads-status.html
   - Respects <meta name="ad-policy" content="off">
   - NZ quiet-hours (2 seeded hours/day)
   - Desktop ~45% / Mobile ~15%, halved by Data Saver or Reduce Motion
   - 10-minute cooldown after a load, and auto-remove after 10 minutes
*/
(function () {
  // --- HARD SKIPS -----------------------------------------------------------
  var path = (location.pathname || '').toLowerCase();
  if (/^\/admin\/ads-status(?:\.html)?$/.test(path)) return; // <- your admin page
  if (document.querySelector('meta[name="ad-policy"][content="off"]')) return;

  // --- CONFIG ---------------------------------------------------------------
  var NZ_TZ = 'Pacific/Auckland';
  var COOLDOWN_MS = 10 * 60 * 1000;
  var LAST_KEY = 'monetagLastShown';
  var MONETAG_URL = 'https://fpyf8.com/88/tag.min.js';
  var MONETAG_ATTR = { 'data-zone': '164840', async: '', 'data-cfasync': 'false' };

  // --- HELPERS --------------------------------------------------------------
  function hash(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function todaySeedNZ() {
    var now = new Date();
    var parts = new Intl.DateTimeFormat('en-NZ', { timeZone: NZ_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(now).reduce(function (a, p) { a[p.type] = p.value; return a; }, {});
    return parts.year + '-' + parts.month + '-' + parts.day;
  }
  function quietHoursFor(seedStr) {
    var h = hash('techability:' + seedStr);
    var h1 = h % 24;
    var h2 = Math.floor(h / 97) % 24;
    if (h2 === h1) h2 = (h2 + 7) % 24;
    return [h1, h2].sort(function (a, b) { return a - b; });
  }
  function inQuietHourNZ(date) {
    var hours = quietHoursFor(todaySeedNZ());
    var nzHour = Number(new Intl.DateTimeFormat('en-NZ', { timeZone: NZ_TZ, hour: 'numeric', hour12: false }).format(date));
    return { inQuiet: hours.indexOf(nzHour) > -1, hours: hours };
  }
  function deviceInfo() {
    var ua = navigator.userAgent || '';
    var mobile = /Mobi|Android|iPhone|iPad/i.test(ua);
    var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    var saveData = !!(conn && conn.saveData);
    var reduce = false;
    try { reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    return { mobile: mobile, saveData: saveData, reduce: reduce };
  }
  function effectiveProbability(dev) {
    var p = dev.mobile ? 0.15 : 0.45;
    if (dev.saveData) p *= 0.5;
    if (dev.reduce) p *= 0.5;
    return p;
  }
  function cooldownActive(now) {
    var last = Number(localStorage.getItem(LAST_KEY) || 0);
    return last && (now - last < COOLDOWN_MS);
  }
  function markShown(now) { try { localStorage.setItem(LAST_KEY, String(now)); } catch (e) {} }

  // --- ELIGIBILITY ----------------------------------------------------------
  var now = Date.now();
  if (cooldownActive(now)) return;
  if (inQuietHourNZ(new Date(now)).inQuiet) return;

  var prob = effectiveProbability(deviceInfo());
  if (Math.random() > prob) return;

  // --- INJECT ---------------------------------------------------------------
  // Guard against multiple inserts
  if (document.querySelector('script[data-monetag-controller]')) return;
  // mark for diagnostics
  var sentinel = document.createElement('meta');
  sentinel.setAttribute('data-monetag-controller', '1');
  document.head.appendChild(sentinel);

  // Add Monetag <script> to <head>
  var s = document.createElement('script');
  s.src = MONETAG_URL;
  Object.keys(MONETAG_ATTR).forEach(function (k) { s.setAttribute(k, MONETAG_ATTR[k]); });
  // Accessibility: any ad containers created later should be inert
  s.addEventListener('load', function () {
    try {
      // Give their tag a moment to render, then harden accessibility + schedule removal
      setTimeout(function () {
        markShown(Date.now());
        // Mark any iframes/divs from monetag as presentational
        document.querySelectorAll('iframe, [id*="monetag"], [class*="monetag"]').forEach(function (el) {
          el.setAttribute('aria-hidden', 'true');
          el.setAttribute('role', 'presentation');
          el.setAttribute('tabindex', '-1');
        });
        // Remove after ~10 minutes (and also clear references)
        setTimeout(function () {
          document.querySelectorAll('script[src*="fpyf8.com/88/tag.min.js"]').forEach(function (x) {
            // script itself can stay; remove ad DOM instead
            x.remove && x.remove();
          });
          document.querySelectorAll('iframe, [id*="monetag"], [class*="monetag"]').forEach(function (el) {
            // best-effort clean
            if (el && el.parentNode) el.parentNode.removeChild(el);
          });
        }, COOLDOWN_MS + 5 * 1000);
      }, 1500);
    } catch (e) {}
  });
  document.head.appendChild(s);
})();
