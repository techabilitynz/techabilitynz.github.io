// scripts/inject-ads.mjs
// Injects: GTM (head+noscript), AdSense (<head>), Monetag runtime (probabilistic, NZ time, mobile-light, accessibility)
// Also removes: any existing AdRoll + old Monetag/AdSense tags.

import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const GTM_ID = process.env.GTM_ID || 'GTM-5RQFQZL6';
const ADSENSE_CLIENT = process.env.ADSENSE_CLIENT || 'ca-pub-9201314612379702';
const MONETAG_ZONE = process.env.MONETAG_ZONE || '164840';

// ---------- helpers ----------
const enc = 'utf8';
const htmlFiles = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.git')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
      htmlFiles.push(full);
    }
  }
}

function contains(str, pattern) {
  return new RegExp(pattern, 'i').test(str);
}
function removeScriptsByPatterns(html, patterns) {
  let out = html;
  patterns.forEach((p) => {
    const re = new RegExp(
      `<script[^>]*>[\\s\\S]*?${p}[\\s\\S]*?<\\/script>`,
      'gi'
    );
    out = out.replace(re, '');
    // also remove external script tags that match in src
    const reSrc = new RegExp(
      `<script[^>]*src=[^>]*${p}[^>]*><\\/script>`,
      'gi'
    );
    out = out.replace(reSrc, '');
  });
  return out;
}

function ensureInHead(html, snippet, marker) {
  const hasMarker = html.includes(marker);
  if (hasMarker) return html; // already injected by us

  const headOpen = html.match(/<head[^>]*>/i);
  if (!headOpen) return html;

  const insertPos = headOpen.index + headOpen[0].length;
  return html.slice(0, insertPos) + `\n${snippet}\n` + html.slice(insertPos);
}

function ensureAfterBodyOpen(html, snippet, marker) {
  const hasMarker = html.includes(marker);
  if (hasMarker) return html;

  const bodyOpen = html.match(/<body[^>]*>/i);
  if (!bodyOpen) return html;

  const insertPos = bodyOpen.index + bodyOpen[0].length;
  return html.slice(0, insertPos) + `\n${snippet}\n` + html.slice(insertPos);
}

// ---------- snippets ----------
const MARK_GTM_HEAD = '<!-- AUTO-GTM-HEAD v1 -->';
const MARK_GTM_BODY = '<!-- AUTO-GTM-BODY v1 -->';
const MARK_ADSENSE = '<!-- AUTO-ADSENSE v1 -->';
const MARK_MONETAG = '<!-- AUTO-MONETAG v1 -->';

// GTM head
const SNIPPET_GTM_HEAD = `${MARK_GTM_HEAD}
<!-- Google Tag Manager -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${GTM_ID}');</script>
<!-- End Google Tag Manager -->`;

// GTM body noscript
const SNIPPET_GTM_BODY = `${MARK_GTM_BODY}
<!-- Google Tag Manager (noscript) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${GTM_ID}"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<!-- End Google Tag Manager (noscript) -->`;

// AdSense head
const SNIPPET_ADSENSE = `${MARK_ADSENSE}
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}" crossorigin="anonymous"></script>`;

// Monetag runtime controller (NZ-time, random, mobile-light, A11y, 10-min cool-down)
const SNIPPET_MONETAG = `${MARK_MONETAG}
<script data-auto-monetag="v1">
(function(){
  try{
    // Respect user settings
    var saveData = (navigator.connection && navigator.connection.saveData) ? 1 : 0;
    var prefersReducedMotion = false;
    try {
      prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch(e){}

    // NZ time helpers
    function nzHour(){
      try{
        var h = new Intl.DateTimeFormat('en-NZ',{ timeZone:'Pacific/Auckland', hour:'2-digit', hour12:false }).format(new Date());
        return parseInt(h, 10);
      }catch(e){
        // Fallback: approximate NZ by local hour (less accurate)
        return new Date().getHours();
      }
    }
    function nzDayKey(){
      try{
        return new Intl.DateTimeFormat('en-NZ',{ timeZone:'Pacific/Auckland', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
      }catch(e){
        var d=new Date();
        return d.getFullYear()+"-"+(d.getMonth()+1)+"-"+d.getDate();
      }
    }
    function hash(s){ for(var i=0,h=0;i<s.length;i++){ h=(h<<5)-h+s.charCodeAt(i); h|=0 } return Math.abs(h); }

    var hour = nzHour();
    var dayKey = nzDayKey();
    var h = hash(dayKey);
    var quiet1 = h % 24;
    var quiet2 = (Math.floor(h/7) % 24);
    if (quiet1 === quiet2) quiet2 = (quiet2 + 6) % 24;
    var inQuiet = (hour === quiet1 || hour === quiet2);

    var isMobile = /Mobi|Android/i.test(navigator.userAgent) || (Math.min(window.innerWidth, window.innerHeight) <= 576);

    // Base probabilities
    var base = isMobile ? 0.15 : 0.45; // mobile-light
    if (saveData) base *= 0.4;
    if (prefersReducedMotion) base *= 0.7;
    if (inQuiet) base *= 0.2;

    var now = Date.now();
    var last = parseInt(localStorage.getItem('mt_last')||'0',10);
    var cooldown = parseInt(localStorage.getItem('mt_cooldown')||'0',10);

    // Honor cool-down window (10 min)
    if (now < cooldown) return;

    // Randomize to not be too frequent
    if (Math.random() >= base) {
      // brief cool-down to avoid retry spam (5 min)
      localStorage.setItem('mt_cooldown', String(now + 5*60*1000));
      return;
    }

    // Accessibility: mark ad nodes aria-hidden when they appear
    function markA11y(el){
      try{
        el.setAttribute('aria-hidden','true');
        el.setAttribute('tabindex','-1');
        el.setAttribute('role','presentation');
      }catch(e){}
    }
    var mo = new MutationObserver(function(muts){
      muts.forEach(function(m){
        m.addedNodes && Array.from(m.addedNodes).forEach(function(n){
          if (n.nodeType !== 1) return;
          var el = n;
          if (el.tagName === 'IFRAME' && (el.src||'').indexOf('fpyf8.com') !== -1) markA11y(el);
          var idc = (el.id||'').toLowerCase() + ' ' + (el.className||'').toString().toLowerCase();
          if (idc.indexOf('monetag') !== -1) markA11y(el);
          el.querySelectorAll('iframe,div').forEach(function(c){
            var idc2 = (c.id||'').toLowerCase() + ' ' + (c.className||'').toString().toLowerCase();
            if ((c.src||'').indexOf('fpyf8.com') !== -1 || idc2.indexOf('monetag') !== -1) markA11y(c);
          });
        });
      });
    });
    try{ mo.observe(document.documentElement, {childList:true, subtree:true}); }catch(e){}

    // Load Monetag script
    function loadMonetag(){
      var s = document.createElement('script');
      s.src = "https://fpyf8.com/88/tag.min.js";
      s.async = true;
      s.setAttribute('data-zone','${MONETAG_ZONE}');
      s.setAttribute('data-cfasync','false');
      document.head.appendChild(s);
    }

    loadMonetag();
    localStorage.setItem('mt_last', String(now));
    localStorage.setItem('mt_cooldown', String(now + 10*60*1000)); // 10 min off after load

    // Remove Monetag after 10 minutes (hide/disappear)
    setTimeout(function(){
      try{
        Array.from(document.querySelectorAll('script[src*="fpyf8.com/88/tag.min.js"]')).forEach(function(el){ el.remove(); });
        Array.from(document.querySelectorAll('iframe[src*="fpyf8.com"], div[id*="monetag"], div[class*="monetag"]')).forEach(function(el){ el.remove(); });
      }catch(e){}
    }, 10*60*1000);

  }catch(err){}
})();
</script>`;

// ---------- main ----------
walk(ROOT);

let changed = 0;
for (const file of htmlFiles) {
  let html = fs.readFileSync(file, enc);

  // 1) Strip AdRoll (if present)
  html = removeScriptsByPatterns(html, [
    'adroll_adv_id',
    's\\.adroll\\.com\\/j\\/',
    'adroll\\.track'
  ]);

  // 2) Strip old Monetag (if present)
  html = removeScriptsByPatterns(html, [
    'fpyf8\\.com\\/88\\/tag\\.min\\.js',
    'data-zone=["\\\']?\\d+["\\\']?'
  ]);
  // 3) Strip any *existing* AdSense tag to re-standardize
  html = removeScriptsByPatterns(html, [
    'pagead2\\.googlesyndication\\.com\\/pagead\\/js\\/adsbygoogle\\.js\\?client='
  ]);

  const before = html;

  // 4) Ensure GTM (head)
  html = ensureInHead(html, SNIPPET_GTM_HEAD, MARK_GTM_HEAD);

  // 5) Ensure AdSense (head)
  html = ensureInHead(html, SNIPPET_ADSENSE, MARK_ADSENSE);

  // 6) Ensure Monetag runtime controller (head)
  html = ensureInHead(html, SNIPPET_MONETAG, MARK_MONETAG);

  // 7) Ensure GTM noscript after <body>
  html = ensureAfterBodyOpen(html, SNIPPET_GTM_BODY, MARK_GTM_BODY);

  if (html !== before) {
    fs.writeFileSync(file, html, enc);
    changed++;
    console.log(`Updated: ${path.relative(ROOT, file)}`);
  }
}

console.log(`Done. Files changed: ${changed}`);
