// Lightweight DirectLink ad injector, no npm deps
// Shows at 5% probability on desktop and mobile
// Caps at 2 shows per device per day
// Skips any paths in SKIP_PATHS, and always skips root nav.html and footer.html
// Removes old Monetag, AdRoll, and prior AUTO-ADS-INJECT blocks
// Strips Git conflict markers including stray ======= lines

import { promises as fs } from "fs";
import path from "path";

const ROOT = process.cwd();
const DIRECT_URL = process.env.DIRECT_LINK_URL || "https://otieu.com/4/9747938";
const DAILY_CAP = Number(process.env.DAILY_CAP || "2");
const SHOW_PROB = Number(process.env.SHOW_PROB || "0.05");
const SKIP_LIST = (process.env.SKIP_PATHS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean)
  .map(n => n.replace(/^\/+/, "")); // normalise to relative

const START_MARK = "<!-- AUTO-ADS-INJECT v2 START -->";
const END_MARK   = "<!-- AUTO-ADS-INJECT v2 END -->";

// Regexes to strip old third party ad code
const STRIP_PATTERNS = [
  // Monetag we used before
  /<script[^>]+monetag[^>]*>\s*<\/script>/gi,
  /<script[^>]+fpyf8\.com\/\d+\/tag\.min\.js[^>]*>\s*<\/script>/gi,
  // AdRoll
  /<script[^>]+s\.adroll\.com\/j\/[^>]*>\s*<\/script>/gi,
  /adroll_adv_id\s*=.+?<\/script>/gis,
  // Our older inject blocks
  new RegExp(`${escapeRegex("<!-- AUTO-ADS-INJECT START -->")}[\\s\\S]*?${escapeRegex("<!-- AUTO-ADS-INJECT END -->")}`, "gi"),
  new RegExp(`${escapeRegex("<!-- AUTO-ADS-INJECT v1 START -->")}[\\s\\S]*?${escapeRegex("<!-- AUTO-ADS-INJECT v1 END -->")}`, "gi"),
  // Remove any existing v2 blocks
  new RegExp(`${escapeRegex(START_MARK)}[\\s\\S]*?${escapeRegex(END_MARK)}`, "gi"),
];

function removeGitConflictMarkers(s) {
  // Remove full conflict blocks
  s = s.replace(
    /^<<<<<<<[^\n]*\n[\s\S]*?\n^=======\s*\n[\s\S]*?\n^>>>>>>>[^\n]*\n/gm,
    ""
  );
  // Remove any leftover single marker lines
  s = s.replace(/^\s*<<<<<<<[^\n]*\n/gm, "");
  s = s.replace(/^\s*=======\s*\n/gm, "");
  s = s.replace(/^\s*>>>>>>>\s*[^\n]*\n/gm, "");
  // Tidy extra blank lines
  return s.replace(/\n{3,}/g, "\n\n");
}

// The injected snippet
const snippet = `${START_MARK}
<script>
(function () {
  // Config
  var DIRECT_URL = ${JSON.stringify(DIRECT_URL)};
  var DAILY_CAP  = ${JSON.stringify(DAILY_CAP)};
  var SHOW_PROB  = ${JSON.stringify(SHOW_PROB)};

  // Escape hatch, add class="no-ads" on <html> to disable page level
  if (document.documentElement.classList.contains('no-ads')) return;

  // Per day cap key
  var today = new Date();
  var y = today.getFullYear();
  var m = String(today.getMonth() + 1).padStart(2, '0');
  var d = String(today.getDate()).padStart(2, '0');
  var DAY_KEY = 'ta_ad_count_' + y + '-' + m + '-' + d;

  function canShow() {
    try {
      var count = Number(localStorage.getItem(DAY_KEY) || '0');
      if (count >= DAILY_CAP) return false;
      if (Math.random() >= SHOW_PROB) return false;
      return true;
    } catch (e) { return false; }
  }

  function markShown() {
    try {
      var c = Number(localStorage.getItem(DAY_KEY) || '0') + 1;
      localStorage.setItem(DAY_KEY, String(c));
    } catch (e) {}
  }

  function inject() {
    var box = document.createElement('div');
    box.className = 'ta-ad-cta';
    box.setAttribute('aria-hidden', 'true');
    box.setAttribute('role', 'presentation');
    box.style.cssText = [
      'position:fixed',
      'bottom:16px',
      'right:16px',
      'z-index:2147483646',
      'display:flex',
      'align-items:center',
      'gap:8px'
    ].join(';');

    var a = document.createElement('a');
    a.href = DIRECT_URL;
    a.target = '_blank';
    a.rel = 'nofollow sponsored';
    a.tabIndex = -1;
    a.style.cssText = [
      'display:inline-block',
      'padding:10px 12px',
      'background:#111',
      'color:#fff',
      'border-radius:12px',
      'text-decoration:none',
      'box-shadow:0 8px 24px rgba(0,0,0,.25)',
      'font:600 14px/1.2 Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif',
      'opacity:.94'
    ].join(';');
    a.textContent = 'Sponsored: useful tech offers';

    var close = document.createElement('button');
    close.type = 'button';
    close.tabIndex = -1;
    close.setAttribute('aria-hidden', 'true');
    close.style.cssText = [
      'background:transparent',
      'border:0',
      'color:#fff',
      'font-size:16px',
      'cursor:pointer',
      'line-height:1'
    ].join(';');
    close.innerHTML = '\\u00D7';
    close.onclick = function () {
      try { box.remove(); } catch (e) { document.body.removeChild(box); }
    };

    box.appendChild(a);
    box.appendChild(close);
    document.body.appendChild(box);
    markShown();
  }

  function init() {
    if (!canShow()) return;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', inject, { once: true });
    } else {
      inject();
    }
  }
  try { init(); } catch (e) {}
})();
</script>
${END_MARK}`;

const edited = [];
await walkAndProcess(".");
if (edited.length) {
  console.log(`Updated ${edited.length} file(s):`);
  edited.forEach(f => console.log(" - " + f));
} else {
  console.log("No HTML changes were needed.");
}

// --------------- helpers ----------------
async function walkAndProcess(relDir) {
  const dir = path.join(ROOT, relDir);
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const ent of entries) {
    const name = ent.name;
    if (name.startsWith(".git") || name === "node_modules" || name === "dist" || name === "build" || name === "vendor") continue;
    if (ent.isDirectory()) {
      await walkAndProcess(path.join(relDir, name));
      continue;
    }
    if (!name.toLowerCase().endsWith(".html")) continue;

    const rel = path.join(relDir, name).replace(/^[.][/\\]?/, "").replace(/\\/g, "/");

    if (shouldSkip(rel)) {
      const changed = await stripOnly(path.join(ROOT, rel));
      if (changed) edited.push(rel);
      continue;
    }

    const changed = await updateHtml(path.join(ROOT, rel));
    if (changed) edited.push(rel);
  }
}

function shouldSkip(relPath) {
  const lower = relPath.toLowerCase();
  if (lower === "nav.html" || lower === "footer.html") return true;
  if (SKIP_LIST.some(p => lower === p.toLowerCase())) return true;
  return false;
}

async function stripOnly(absFile) {
  let html = await fs.readFile(absFile, "utf8");
  const original = html;
  STRIP_PATTERNS.forEach(rx => { html = html.replace(rx, ""); });
  html = removeGitConflictMarkers(html);
  if (html !== original) {
    await fs.writeFile(absFile, html, "utf8");
    return true;
  }
  return false;
}

async function updateHtml(absFile) {
  let html = await fs.readFile(absFile, "utf8");
  const original = html;

  STRIP_PATTERNS.forEach(rx => { html = html.replace(rx, ""); });
  // ensure no duplicate v2 block
  html = html.replace(new RegExp(`${escapeRegex(START_MARK)}[\\s\\S]*?${escapeRegex(END_MARK)}`, "gi"), "");

  const bodyCloseRx = /<\/body\s*>/i;
  if (bodyCloseRx.test(html)) {
    html = html.replace(bodyCloseRx, `${snippet}\n</body>`);
  } else {
    html = html + `\n${snippet}\n`;
  }

  html = removeGitConflictMarkers(html);

  if (html !== original) {
    await fs.writeFile(absFile, html, "utf8");
    return true;
  }
  return false;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
