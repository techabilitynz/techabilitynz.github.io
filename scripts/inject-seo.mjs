#!/usr/bin/env node
// SEO, Ads, and GTM injector, idempotent, Node 18 or 20
// Injects on full pages only
// Skips injections on root nav.html and footer.html, but cleans them if polluted
// Strips Git conflict markers including stray ======= lines
// Never injects AdSense or Monetag on admin/ads-status.html

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

// ------------- CONFIG -------------
const SITE_URL       = (process.env.SITE_URL       || 'https://www.techability.co.nz').replace(/\/+$/, '');
const SITE_NAME      =  process.env.SITE_NAME      || 'Tech Ability';
const DEFAULT_IMAGE  =  process.env.DEFAULT_IMAGE  || 'https://i.postimg.cc/SQ6GFs1B/banner-1200-630.jpg';
const SITE_DESC      =  process.env.SITE_DESC      || 'Tech Ability Internet for New Zealand with Christchurch based support, plus tech support for phones, laptops, tablets, and smart homes, with friendly, accessible service.';
const FACEBOOK_URL   =  process.env.FACEBOOK_URL   || 'https://www.facebook.com/TechAbilityCHCH';
const GTM_ID         =  process.env.GTM_ID         || 'GTM-5RQFQZL6';
const ADSENSE_CLIENT =  process.env.ADSENSE_CLIENT || 'ca-pub-9201314612379702';

// Pages that must never receive ads
const SKIP_ADS_PATHS = [
  /^admin\/ads-status\.html$/i,
];

// Partials that must never receive any injections
const SKIP_PARTIALS = [
  /^nav\.html$/i,
  /^footer\.html$/i,
];

// Ignore dirs
const IGNORE_DIRS = new Set([
  '.git', '.github', 'node_modules', 'vendor', 'dist', 'build', 'Backup', 'Backups'
]);

// ------------- Snippets -------------
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

// ------------- Utilities -------------
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

function escapeAttr(s) { return String(s).replace(/"/g, '&quot;'); }
function toRel(p) { return path.relative(repoRoot, p).replace(/\\/g, '/'); }

function toCanonical(rel) {
  const norm = rel.replace(/^\/*/, '/');
  if (/\/index\.html$/i.test(norm)) return SITE_URL + norm.replace(/index\.html$/i, '');
  return SITE_URL + norm;
}

function getTitle(html) {
  const m = html.match(/<title>([\s\S]*?)<\/title>/i);
  return m ? m[1].trim() : SITE_NAME;
}

function stripTags(s) { return s.replace(/<[^>]*>/g, ''); }

function getOrMakeDescription(html) {
  const ex = html.match(/<meta\s+name=["']description["']\s+content=["']([\s\S]*?)["']\s*\/?>/i);
  if (ex) return ex[1].trim();
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) {
    const text = stripTags(h1[1]).trim().replace(/\s+/g, ' ');
    return `${text} — ${SITE_DESC}`;
  }
  const p = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  if (p) return stripTags(p[1]).trim().replace(/\s+/g, ' ').slice(0, 300);
  return SITE_DESC;
}

function removeBetweenComments(html) {
  const re = new RegExp(`${escapeReg(commentStart)}[\\s\\S]*?${escapeReg(commentEnd)}`, 'i');
  return html.replace(re, '');
}

function escapeReg(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function stripLegacyAds(html) {
  // Old AdSense
  html = html.replace(/<script[^>]+pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js[^>]*>\s*<\/script>/gi, '');
  // AdRoll
  html = html.replace(/<script[^>]*>[\s\S]*?adroll[^<]*<\/script>/gi, '');
  // Direct Monetag embeds
  html = html.replace(/<script[^>]+fpyf8\.com\/\d+\/tag\.min\.js[^>]*>\s*<\/script>/gi, '');
  // Our AUTO-ADS-INJECT v2 blocks
  html = html.replace(/<!--\s*AUTO-ADS-INJECT v2 START\s*-->[\s\S]*?<!--\s*AUTO-ADS-INJECT v2 END\s*-->/gi, '');
  return html;
}

function stripGtm(html) {
  html = html.replace(/<!--\s*Google Tag Manager\s*-->[\s\S]*?<!--\s*End Google Tag Manager\s*-->/gi, '');
  html = html.replace(/<!--\s*Google Tag Manager \(noscript\)\s*-->[\s\S]*?<!--\s*End Google Tag Manager \(noscript\)\s*-->/gi, '');
  return html;
}

function stripMonetagController(html) {
  return html.replace(/<script[^>]+monetag-control\.js[^>]*>\s*<\/script>/gi, '');
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
    return html.replace(/<script[^>]+pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js[^>]*>\s*<\/script>/gi, '');
  }
  if (!/pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js\?client=/i.test(html)) {
    html = html.replace(/<head[^>]*>/i, (m) => `${m}\n${adsenseHeadSnippet(ADSENSE_CLIENT)}\n`);
  }
  return html;
}

function injectGtm(html) {
  html = stripGtm(html);
  html = html.replace(/<head[^>]*>/i, (m) => `${m}\n${gtmHeadSnippet(GTM_ID)}\n`);
  html = html.replace(/<body[^>]*>/i, (m) => `${m}\n${gtmBodyNoscript(GTM_ID)}\n`);
  return html;
}

function injectMonetagController(html, relPath) {
  html = stripMonetagController(html);
  if (shouldSkipAds(relPath)) return html;
  if (/<\/body>/i.test(html)) {
    html = html.replace(/<\/body>\s*<\/html>\s*$/i, () => `  <script src="/scripts/monetag-control.js" defer></script>\n</body>\n</html>`);
  } else {
    html += `\n<script src="/scripts/monetag-control.js" defer></script>\n`;
  }
  return html;
}

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

function injectSeoBlock(html, relPath) {
  // Clean partials, never inject
  if (shouldSkipPartials(relPath)) {
    html = removeBetweenComments(html);
    html = stripLegacyAds(html);
    html = stripGtm(html);
    html = stripMonetagController(html);
    return removeGitConflictMarkers(html);
  }

  const canonical = toCanonical(relPath);
  const title = getTitle(html);
  const desc  = getOrMakeDescription(html);

  // Start clean
  html = removeBetweenComments(html);
  html = stripLegacyAds(html);

  // GTM
  html = injectGtm(html);

  // SEO basics
  html = ensureRobots(html);
  html = ensureFacebookPublisher(html);

  // Canonical
  if (/<link\s+rel=["']canonical["']/i.test(html)) {
    html = html.replace(/<link\s+rel=["']canonical["'][^>]*>/i, `<link rel="canonical" href="${escapeAttr(canonical)}">`);
  } else {
    html = html.replace(/<\/head>/i, `\n<link rel="canonical" href="${escapeAttr(canonical)}">\n</head>`);
  }

  // Description
  if (/<meta\s+name=["']description["']/i.test(html)) {
    html = html.replace(/<meta\s+name=["']description["']\s+content=["'][\s\S]*?["']\s*\/?>/i, `<meta name="description" content="${escapeAttr(desc)}">`);
  } else {
    html = html.replace(/<\/head>/i, `\n<meta name="description" content="${escapeAttr(desc)}">\n</head>`);
  }

  // OG, Twitter, JSON-LD
  const ogTw = ogTwitterBlock({ url: canonical, title, desc, image: DEFAULT_IMAGE });
  const block = `\n${commentStart}\n${ogTw}\n${commentEnd}\n`;
  html = html.replace(/<\/head>/i, block + '</head>');

  // Ads and controller
  html = injectAdSenseIfAllowed(html, relPath);
  html = injectMonetagController(html, relPath);

  // Final clean
  return removeGitConflictMarkers(html);
}

function shouldSkipAds(relPath) {
  const clean = relPath.replace(/^\.?\//, '');
  return SKIP_ADS_PATHS.some((rx) => rx.test(clean));
}

function shouldSkipPartials(relPath) {
  const clean = relPath.replace(/^\.?\//, '');
  return SKIP_PARTIALS.some((rx) => rx.test(clean));
}

// ------------- Main -------------
const files = walk(repoRoot);
let changed = 0;

files.forEach((abs) => {
  const rel = toRel(abs);
  let html = fs.readFileSync(abs, 'utf8');

  const before = html;
  html = injectSeoBlock(html, rel);

  if (html !== before) {
    fs.writeFileSync(abs, html, 'utf8');
    console.log('Updated:', rel,
      shouldSkipPartials(rel) ? '(cleaned partial, no injection)' :
      shouldSkipAds(rel) ? '(ads skipped)' : ''
    );
    changed++;
  }
});

if (!changed) {
  console.log('No HTML changes needed.');
}
