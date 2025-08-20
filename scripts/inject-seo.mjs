/* scripts/inject-seo.mjs
 * Injects (idempotent):
 *  - Google Tag Manager (head + body noscript)
 *  - Google AdSense loader (head)
 *  - AdRoll loader (head)
 *  - Canonical, meta description, OG/Twitter, JSON-LD (Organization) block
 * Also removes any older/duplicate GTM, AdSense, AdRoll snippets.
 * Skips /beta, /backup, /backups, .git, node_modules.
 */

import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const SITE_URL = (process.env.SITE_URL || "").replace(/\/+$/, "");
const SITE_NAME = process.env.SITE_NAME || "Tech Ability";
const DEFAULT_IMAGE = process.env.DEFAULT_IMAGE || "";
const SITE_DESC = process.env.SITE_DESC || "";
const FACEBOOK_URL = process.env.FACEBOOK_URL || "";
const ADSENSE_CLIENT = process.env.ADSENSE_CLIENT || "";
const GTM_ID = process.env.GTM_ID || "";
const ADROLL_ADV_ID = process.env.ADROLL_ADV_ID || "";
const ADROLL_PIX_ID = process.env.ADROLL_PIX_ID || "";

const EXCLUDE_DIRS = new Set([".git", "node_modules"]);
const EXCLUDE_MATCH = [/^beta$/i, /^backup$/i, /^backups$/i];

const AUTO_START = "<!-- AUTO-SEO-INJECT v1 -->";
const AUTO_END = "<!-- /AUTO-SEO-INJECT -->";

function walk(dir) {
  const out = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.isDirectory()) {
      if (EXCLUDE_DIRS.has(item.name)) continue;
      if (EXCLUDE_MATCH.some((rx) => rx.test(item.name))) continue;
      out.push(...walk(path.join(dir, item.name)));
    } else if (item.isFile() && item.name.toLowerCase().endsWith(".html")) {
      out.push(path.join(dir, item.name));
    }
  }
  return out;
}

function toPosix(p) {
  return p.split(path.sep).join("/");
}

function relUrl(filePath) {
  const rel = toPosix(path.relative(ROOT, filePath));
  if (rel.toLowerCase() === "index.html") return "/";
  if (rel.toLowerCase().endsWith("/index.html")) {
    return "/" + rel.slice(0, -"/index.html".length) + "/";
  }
  return "/" + rel;
}

function escapeAttr(v = "") {
  return String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function readFile(p) { return fs.readFileSync(p, "utf8"); }
function writeFile(p, s) { fs.writeFileSync(p, s, "utf8"); }

function hasHeadAndBody(html) {
  return /<head[^>]*>/i.test(html) && /<\/head>/i.test(html) && /<body[^>]*>/i.test(html);
}

function stripOldAutoBlock(html) {
  const rx = new RegExp(`${AUTO_START}[\\s\\S]*?${AUTO_END}`, "i");
  return html.replace(rx, "");
}

/* ---------- GTM ---------- */
function stripAnyGTM(html) {
  const gtmHeadRx = /<script[^>]*>(?:(?!<\/script>).)*googletagmanager\.com\/gtm\.js[^<]*<\/script>\s*/gis;
  html = html.replace(gtmHeadRx, "");
  const gtmExternalRx = /<script[^>]*\s+src=["']https:\/\/www\.googletagmanager\.com\/gtm\.js[^"']*["'][^>]*>\s*<\/script>\s*/gi;
  html = html.replace(gtmExternalRx, "");
  const gtmNoScriptRx = /<noscript>\s*<iframe[^>]*\s+src=["']https:\/\/www\.googletagmanager\.com\/ns\.html\?id=[^"']+["'][^>]*><\/iframe>\s*<\/noscript>\s*/gi;
  html = html.replace(gtmNoScriptRx, "");
  return html;
}

function injectGTM(html, gtmId) {
  if (!gtmId || !hasHeadAndBody(html)) return html;
  html = stripAnyGTM(html);

  const gtmHeadSnippet =
`<!-- Google Tag Manager -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${gtmId}');</script>
<!-- End Google Tag Manager -->`;

  const gtmBodyNoscript =
`<!-- Google Tag Manager (noscript) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${gtmId}"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<!-- End Google Tag Manager (noscript) -->`;

  html = html.replace(/<head[^>]*>/i, (m) => `${m}\n${gtmHeadSnippet}\n`);
  html = html.replace(/<body([^>]*)>/i, (m, attrs) => `<body${attrs}>\n${gtmBodyNoscript}\n`);
  return html;
}

/* ---------- AdSense ---------- */
function injectAdSense(html) {
  if (!ADSENSE_CLIENT || !/<head[^>]*>/i.test(html)) return html;
  const anyAdsLoaderRx = /<script[^>]*\s+src=["']\s*https:\/\/pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js(?:\?[^"']*)?["'][^>]*>\s*<\/script>\s*/ig;
  html = html.replace(anyAdsLoaderRx, "");
  const snippet =
`<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${escapeAttr(ADSENSE_CLIENT)}"
     crossorigin="anonymous"></script>`;
  if (!html.includes(snippet)) {
    html = html.replace(/<head[^>]*>/i, (m) => `${m}\n${snippet}\n`);
  }
  return html;
}

/* ---------- AdRoll ---------- */
function stripAnyAdRoll(html) {
  // Remove inline blocks that declare adroll_adv_id, or load s.adroll.com
  const adrollInlineRx = /<script[^>]*>(?:(?!<\/script>).)*(?:adroll_adv_id|s\.adroll\.com\/j\/)[\s\S]*?<\/script>\s*/gi;
  html = html.replace(adrollInlineRx, "");
  // Remove external script tags to s.adroll.com if any
  const adrollSrcRx = /<script[^>]*\s+src=["'][^"']*s\.adroll\.com\/j\/[^"']*["'][^>]*>\s*<\/script>\s*/gi;
  html = html.replace(adrollSrcRx, "");
  return html;
}

function injectAdRoll(html) {
  if (!ADROLL_ADV_ID || !ADROLL_PIX_ID || !/<head[^>]*>/i.test(html)) return html;
  html = stripAnyAdRoll(html);
  const snippet =
`<!-- AdRoll -->
<script type="text/javascript">
  adroll_adv_id = "${ADROLL_ADV_ID}";
  adroll_pix_id = "${ADROLL_PIX_ID}";
  adroll_version = "2.0";
  (function(w, d, e, o, a) {
    w.__adroll_loaded = true;
    w.adroll = w.adroll || [];
    w.adroll.f = [ 'setProperties', 'identify', 'track', 'identify_email', 'get_cookie' ];
    var roundtripUrl = "https://s.adroll.com/j/" + adroll_adv_id + "/roundtrip.js";
    for (a = 0; a < w.adroll.f.length; a++) {
      w.adroll[w.adroll.f[a]] = w.adroll[w.adroll.f[a]] || (function(n) {
        return function() { w.adroll.push([ n, arguments ]) }
      })(w.adroll.f[a])
    }
    e = d.createElement('script'); o = d.getElementsByTagName('script')[0];
    e.async = 1; e.src = roundtripUrl; o.parentNode.insertBefore(e, o);
  })(window, document);
  adroll.track("pageView");
</script>
<!-- /AdRoll -->`;

  // Place after AdSense (near top of head)
  html = html.replace(/<head[^>]*>/i, (m) => `${m}\n${snippet}\n`);
  return html;
}

/* ---------- SEO Block ---------- */
function pickPageDescription(fileRelPath, html) {
  const m = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["'][^>]*>/i);
  if (m && m[1]) return m[1].trim();

  const rel = fileRelPath.toLowerCase();
  if (rel === "/") {
    return "Clear, friendly tech support in Christchurch and across New Zealand. Help for phones, laptops, tablets and smart homes.";
  }
  if (rel.includes("/internet") || rel === "/internet.html") {
    return "Fibre & Hyperfibre internet across NZ with Christchurch-based support. Simple pricing, symmetric speeds up to 4000 Mbps.";
  }
  if (rel.includes("/contact") || rel === "/contact.html") {
    return "Contact Tech Ability — phone, email, or message. Friendly, accessible tech help in Christchurch and across NZ.";
  }
  return SITE_DESC || "Tech support and NZ internet with Christchurch-based help.";
}

function buildAutoSeoBlock({ pageUrl, titleText, description }) {
  const canonical = SITE_URL ? `${SITE_URL}${pageUrl}` : pageUrl;
  const ogTitle = titleText || SITE_NAME;
  const ogDesc = description || SITE_DESC;
  const orgJson = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL || undefined,
    sameAs: FACEBOOK_URL ? [FACEBOOK_URL] : undefined,
    areaServed: "NZ",
  };

  return [
    AUTO_START,
    `<meta name="description" content="${escapeAttr(ogDesc)}">`,
    `<link rel="canonical" href="${escapeAttr(canonical)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${escapeAttr(SITE_NAME)}">`,
    `<meta property="og:url" content="${escapeAttr(canonical)}">`,
    `<meta property="og:title" content="${escapeAttr(ogTitle)}">`,
    `<meta property="og:description" content="${escapeAttr(ogDesc)}">`,
    DEFAULT_IMAGE ? `<meta property="og:image" content="${escapeAttr(DEFAULT_IMAGE)}">` : "",
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escapeAttr(ogTitle)}">`,
    `<meta name="twitter:description" content="${escapeAttr(ogDesc)}">`,
    DEFAULT_IMAGE ? `<meta name="twitter:image" content="${escapeAttr(DEFAULT_IMAGE)}">` : "",
    `<script type="application/ld+json">${JSON.stringify(orgJson)}</script>`,
    AUTO_END,
  ].filter(Boolean).join("\n");
}

function updateAutoSeo(html, filePath) {
  if (!hasHeadAndBody(html)) return html;
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const titleText = titleMatch ? titleMatch[1].trim() : SITE_NAME;

  const pageUrl = relUrl(filePath);
  const description = pickPageDescription(pageUrl, html);
  const block = buildAutoSeoBlock({ pageUrl, titleText, description });

  let out = stripOldAutoBlock(html);
  out = out.replace(/<head[^>]*>/i, (m) => `${m}\n${block}\n`);
  return out;
}

/* ---------- Pipeline ---------- */
function processFile(absPath) {
  const original = readFile(absPath);
  if (!/<html[^>]*>/i.test(original)) return null;

  let html = original;

  // 1) GTM (head + body)
  html = injectGTM(html, GTM_ID);

  // 2) AdSense (head)
  html = injectAdSense(html);

  // 3) AdRoll (head)
  html = injectAdRoll(html);

  // 4) SEO block
  html = updateAutoSeo(html, absPath);

  if (html !== original) {
    writeFile(absPath, html);
    return true;
  }
  return false;
}

function main() {
  const files = walk(ROOT);
  let changed = 0;
  for (const f of files) {
    const posix = toPosix(path.relative(ROOT, f));
    const parts = posix.split("/");
    if (parts.some((p) => EXCLUDE_MATCH.some((rx) => rx.test(p)))) continue;
    const did = processFile(f);
    if (did) {
      changed++;
      console.log("Updated:", posix);
    }
  }
  console.log(`Done. Files updated: ${changed}`);
}

main();
