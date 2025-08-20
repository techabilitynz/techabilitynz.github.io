#!/usr/bin/env node
// Tech Ability — SEO/Ads/GTM injector (idempotent, Node 18+ / 20+)
// - Inject/refresh SEO tags (description/canonical/OG/Twitter/JSON-LD/Facebook publisher)
// - Inject AdSense in <head> (unless page is ad-skipped)
// - Inject GTM in <head> + <body> noscript
// - Add Monetag controller <script> before </body> (unless ad-skipped)
// - Remove legacy AdSense/AdRoll/Monetag snippets
// - Never inject Monetag or AdSense on admin/ads-status.html

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

// -------------------- CONFIG (via env with fallbacks) -----------------------
const SITE_URL       = (process.env.SITE_URL       || 'https://www.techability.co.nz').replace(/\/+$/, '');
const SITE_NAME      =  process.env.SITE_NAME      || 'Tech Ability';
const DEFAULT_IMAGE  =  process.env.DEFAULT_IMAGE  || 'https://i.postimg.cc/SQ6GFs1B/banner-1200-630.jpg';
const SITE_DESC      =  process.env.SITE_DESC      || 'Tech Ability Internet for New Zealand with Christchurch based support, plus tech support for phones, laptops, tablets, and smart homes, with friendly, accessible service.';
const FACEBOOK_URL   =  process.env.FACEBOOK_URL   || 'https://www.facebook.com/TechAbilityCHCH';
const GTM_ID         =  process.env.GTM_ID         || 'GTM-5RQFQZL6';
const ADSENSE_CLIENT =  process.env.ADSENSE_CLIENT || 'ca-pub-9201314612379702';

// Pages that must NEVER receive ads (AdSense & Monetag). Regex paths relative to repo root.
const SKIP_ADS_PATHS = [
  /^admin\/ads-status\.html$/i,      // hard block (your admin status page)
  // Add more patterns here if you want to exclude other pages later
];

// Files/dirs to ignore when scanning
const IGNORE_DIRS = new Set([
  '.git', '.github', 'node_modules', 'vendor', 'dist', 'build', 'Backup', 'Backups'
]);

// -------------------- Snippets -----------------------
const commentStart = '<!-- AUTO-SEO-INJECT v1 -->';
const commentEnd   = '<!-- /AUTO-SEO-INJECT -->';

function gtmHeadSnippet(id) {
  return [
    '<!-- Google Tag Manager -->',
    `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':`,
    `new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],`,
    `j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=`,
    `'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);`,
    `})(window,document,'script','dataLayer','${id}');</script>`,
    '<!-- End Google Tag Manager -->'
  ].join('\n');
}

function gtmBodyNoscript(id) {
  return [
    '<!-- Google Tag Manager (noscript) -->',
    `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${id}"`,
    `height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`,
    '<!-- End Google Tag Manager (noscript) -->'
  ].join('\n');
}

function adsenseHeadSnippet(client) {
  return `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}" crossorigin="anonymous"></script>`;
}

function jsonLdOrg() {
  // Keep it minimal; we also allow pages to include their own <script data-techability="seo"> blocks
  return `<script type="application/ld+json">` +
    JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Organization",
      "name": SITE_NAME,
      "url": SITE_URL,
      "sameAs": [ FACEBOOK_URL ],
      "areaServed": "NZ"
    }) +
    `</script>`;
}

function ogTwitterBlock({ url, title, desc, image }) {
  return [
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${escapeAttr(SITE_NAME)}">`,
    `<meta property="og:url" content="${escapeAttr(url)}">`,
    `<meta property="og:title" content="${escapeAttr(title)}">`,
    `<meta property="og:description" content="${escapeAttr(desc)}">`,
    `<meta property="og:image" content="${escapeAttr(image)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escapeAttr(title)}">`,
    `<meta name="twitter:description" content="${escapeAttr(desc)}">`,
    `<meta name="twitter:image" content="${escapeAttr(image)}">`,
    jsonLdOrg()
  ].join('\n');
}

// -------------------- Utilities -----------------------
function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let out = [];
  for (const e of entries) {
    if (e.isDirectory()) {
      if (IGNORE_DIRS.has(e.name)) continue;
      out = out.concat(walk(path.join(dir, e.name)));
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.html')) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;');
}

function toRel(p) {
  return path.relative(repoRoot, p).replace(/\\/g, '/');
}

function toCanonical(rel) {
  // /index.html -> /
  const norm = rel.replace(/^\/*/, '/');
  if (/\/index\.html$/i.test(norm)) {
    return SITE_URL + norm.replace(/index\.html$/i, '');
  }
  return SITE_URL + norm;
}

function getTitle(html) {
  const m = html.match(/<title>([\s\S]*?)<\/title>/i);
  return m ? m[1].trim() : SITE_NAME;
}

function getOrMakeDescription(html) {
  // Prefer existing <meta name="description">
  const ex = html.match(/<meta\s+name=["']description["']\s+content=["']([\s\S]*?)["']\s*\/?>/i);
  if (ex) return ex[1].trim();

  // Otherwise, derive from first <h1> or first <p>
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) {
    const text = stripTags(h1[1]).trim().replace(/\s+/g, ' ');
    return `${text} — ${SITE_DESC}`;
  }
  const p = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  if (p) {
    return stripTags(p[1]).trim().replace(/\s+/g, ' ').slice(0, 300);
  }
  return SITE_DESC;
}

function stripTags(s) {
  return s.replace(/<[^>]*>/g, '');
}

function removeBetweenComments(html) {
  // Remove prior AUTO-SEO-INJECT block for clean re-insert
  const re = new RegExp(`${escapeReg(commentStart)}[\\s\\S]*?${escapeReg(commentEnd)}`, 'i');
  return html.replace(re, '');
}

function escapeReg(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripLegacyAds(html) {
  // Remove any old AdSense script(s)
  html = html.replace(/<script[^>]+pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js[^>]*>\s*<\/script>/gi, '');
  // Remove any AdRoll remnants
  html = html.replace(/<script[^>]*>[\s\S]*?adroll[^<]*<\/script>/gi, '');
  // Remove any direct Monetag embeds (we rely on our controller instead)
  html = html.replace(/<script[^>]+fpyf8\.com\/88\/tag\.min\.js[^>]*>\s*<\/script>/gi, '');
  return html;
}

function stripGtm(html) {
  html = html.replace(/<!--\s*Google Tag Manager\s*-->[\s\S]*?<!--\s*End Google Tag Manager\s*-->/gi, '');
  html = html.replace(/<!--\s*Google Tag Manager \(noscript\)\s*-->[\s\S]*?<!--\s*End Google Tag Manager \(noscript\)\s*-->/gi, '');
  return html;
}

function ensureRobots(html) {
  if (!/name=["']robots["']/i.test(html)) {
    html = html.replace(/<\/head>/i, `\n<meta name="robots" content="index,follow">\n</head>`);
  }
  return html;
}

function ensureFacebookPublisher(html) {
  if (!/property=["']article:publisher["']/i.test(html)) {
    html = html.replace(/<\/head>/i, `\n<meta property="article:publisher" content="${escapeAttr(FACEBOOK_URL)}">`);
  }
  if (!/property=["']og:see_also["']/i.test(html)) {
    html = html.replace(/<\/head>/i, `\n<meta property="og:see_also" content="${escapeAttr(FACEBOOK_URL)}">`);
  }
  return html;
}

function injectAdSenseIfAllowed(html, relPath) {
  if (shouldSkipAds(relPath)) {
    // Strip any existing AdSense too
    return html.replace(/<script[^>]+pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js[^>]*>\s*<\/script>/gi, '');
  }
  if (!/pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js\?client=/i.test(html)) {
    html = html.replace(/<head[^>]*>/i, (m) => `${m}\n${adsenseHeadSnippet(ADSENSE_CLIENT)}\n`);
  }
  return html;
}

function injectGtm(html) {
  html = stripGtm(html);
  // Insert head GTM as high as possible inside <head>
  html = html.replace(/<head[^>]*>/i, (m) => `${m}\n${gtmHeadSnippet(GTM_ID)}\n`);
  // Insert noscript immediately after <body>
  html = html.replace(/<body[^>]*>/i, (m) => `${m}\n${gtmBodyNoscript(GTM_ID)}\n`);
  return html;
}

function injectMonetagController(html, relPath) {
  // Remove any old controller references to keep a single one at the end
  html = html.replace(/<script[^>]+monetag-control\.js[^>]*>\s*<\/script>/gi, '');
  if (shouldSkipAds(relPath)) return html; // don't add on admin/ads-status.html

  // Add the controller right before </body>
  if (/<\/body>/i.test(html)) {
    html = html.replace(/<\/body>\s*<\/html>\s*$/i, (m) => `  <script src="/scripts/monetag-control.js" defer></script>\n</body>\n</html>`);
  } else {
    // Edge case: missing </body> — append at end
    html += `\n<script src="/scripts/monetag-control.js" defer></script>\n`;
  }
  return html;
}

function injectSeoBlock(html, relPath) {
  const canonical = toCanonical(relPath);
  const title = getTitle(html);
  const desc  = getOrMakeDescription(html);

  // remove prior injected block and stale GTM/ads first
  html = removeBetweenComments(html);
  html = stripLegacyAds(html);
  html = injectGtm(html); // always inject/refresh GTM
  html = ensureRobots(html);
  html = ensureFacebookPublisher(html);

  // canonical: replace existing or add
  if (/<link\s+rel=["']canonical["']/i.test(html)) {
    html = html.replace(/<link\s+rel=["']canonical["'][^>]*>/i, `<link rel="canonical" href="${escapeAttr(canonical)}">`);
  } else {
    html = html.replace(/<\/head>/i, `\n<link rel="canonical" href="${escapeAttr(canonical)}">\n</head>`);
  }

  // description: replace or add
  if (/<meta\s+name=["']description["']/i.test(html)) {
    html = html.replace(/<meta\s+name=["']description["']\s+content=["'][\s\S]*?["']\s*\/?>/i, `<meta name="description" content="${escapeAttr(desc)}">`);
  } else {
    html = html.replace(/<\/head>/i, `\n<meta name="description" content="${escapeAttr(desc)}">\n</head>`);
  }

  // OG + Twitter + minimal JSON-LD block wrapped in injector comments
  const ogTw = ogTwitterBlock({ url: canonical, title, desc, image: DEFAULT_IMAGE });
  const block = `\n${commentStart}\n${ogTw}\n${commentEnd}\n`;
  html = html.replace(/<\/head>/i, block + '</head>');

  // AdSense (if allowed) and Monetag controller
  html = injectAdSenseIfAllowed(html, relPath);
  html = injectMonetagController(html, relPath);

  return html;
}

function shouldSkipAds(relPath) {
  const clean = relPath.replace(/^\.?\//, '');
  return SKIP_ADS_PATHS.some((rx) => rx.test(clean));
}

// -------------------- Main -----------------------
const files = walk(repoRoot);
let changed = 0;

files.forEach((abs) => {
  const rel = toRel(abs);
  let html = fs.readFileSync(abs, 'utf8');

  const before = html;
  html = injectSeoBlock(html, rel);

  if (html !== before) {
    fs.writeFileSync(abs, html, 'utf8');
    console.log('Updated:', rel, shouldSkipAds(rel) ? '(ads skipped)' : '');
    changed++;
  }
});

if (!changed) {
  console.log('No HTML changes needed.');
}
