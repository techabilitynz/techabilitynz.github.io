/* scripts/inject-seo.mjs
 * Injects:
 *  - Google Tag Manager (head loader + body noscript)
 *  - Google AdSense header loader
 *  - Canonical, meta description, OG/Twitter, JSON-LD (Organization/WebSite/WebPage)
 * Idempotent. Removes any prior GTM/AdSense loaders and our AUTO-SEO block.
 * Skips /beta, /backup, /backups (any case), .git, node_modules.
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
  // canonical rule: index.html at root => "/"
  if (rel.toLowerCase() === "index.html") return "/";
  // nested index.html => "/folder/"
  if (rel.toLowerCase().endsWith("/index.html")) {
    return "/" + rel.slice(0, -"/index.html".length) + "/";
  }
  return "/" + rel;
}

function escapeAttr(v = "") {
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;");
}

function readFile(p) {
  return fs.readFileSync(p, "utf8");
}
function writeFile(p, s) {
  fs.writeFileSync(p, s, "utf8");
}

function hasHeadAndBody(html) {
  return /<head[^>]*>/i.test(html) && /<\/head>/i.test(html) && /<body[^>]*>/i.test(html);
}

function stripOldAutoBlock(html) {
  const rx = new RegExp(
    `${AUTO_START}[\\s\\S]*?${AUTO_END}`,
    "i"
  );
  return html.replace(rx, "");
}

/** Remove any GTM loader in <head> (inline or external) and any GTM noscript in <body> */
function stripAnyGTM(html) {
  // Inline GTM loader (classic snippet) and any script loading /gtm.js
  const gtmHeadRx =
    /<script[^>]*>(?:(?!<\/script>).)*googletagmanager\.com\/gtm\.js[^<]*<\/script>\s*/gis;
  html = html.replace(gtmHeadRx, "");

  const gtmExternalRx =
    /<script[^>]*\s+src=["']https:\/\/www\.googletagmanager\.com\/gtm\.js[^"']*["'][^>]*>\s*<\/script>\s*/gi;
  html = html.replace(gtmExternalRx, "");

  // Body noscript iframe
  const gtmNoScriptRx =
    /<noscript>\s*<iframe[^>]*\s+src=["']https:\/\/www\.googletagmanager\.com\/ns\.html\?id=[^"']+["'][^>]*><\/iframe>\s*<\/noscript>\s*/gi;
  html = html.replace(gtmNoScriptRx, "");

  return html;
}

/** Inserts GTM head loader right after opening <head>, and noscript right after <body> */
function injectGTM(html, gtmId) {
  if (!gtmId) return html;
  if (!hasHeadAndBody(html)) return html;

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

  // Insert at top of <head>
  html = html.replace(/<head[^>]*>/i, (m) => `${m}\n${gtmHeadSnippet}\n`);

  // Insert immediately after opening <body ...>
  html = html.replace(/<body([^>]*)>/i, (m, attrs) => `<body${attrs}>\n${gtmBodyNoscript}\n`);

  return html;
}

/** Remove any AdSense header loader and insert the canonical one */
function injectAdSense(html) {
  if (!ADSENSE_CLIENT) return html;
  if (!/<head[^>]*>/i.test(html) || !/<\/head>/i.test(html)) return html;

  // Strip any existing loader
  const anyAdsLoaderRx =
    /<script[^>]*\s+src=["']\s*https:\/\/pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js(?:\?[^"']*)?["'][^>]*>\s*<\/script>\s*/ig;
  html = html.replace(anyAdsLoaderRx, "");

  const snippet =
    `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${escapeAttr(
      ADSENSE_CLIENT
    )}"
     crossorigin="anonymous"></script>`;

  // Put after GTM (which we already prepend), still at top of head
  if (!html.includes(snippet)) {
    html = html.replace(/<head[^>]*>/i, (m) => `${m}\n${snippet}\n`);
  }

  return html;
}

function pickPageDescription(fileRelPath, html) {
  // If page already has a <meta name="description"> keep it (we'll update/normalize inside the block)
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
  // fallback
  return SITE_DESC || "Tech support and NZ internet with Christchurch-based help.";
}

function buildAutoSeoBlock({ pageUrl, titleText, description }) {
  // Ensure canonical absolute URL
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
  ]
    .filter(Boolean)
    .join("\n");
}

function updateAutoSeo(html, filePath) {
  if (!hasHeadAndBody(html)) return html;

  // Title
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const titleText = titleMatch ? titleMatch[1].trim() : SITE_NAME;

  const pageUrl = relUrl(filePath);
  const description = pickPageDescription(pageUrl, html);
  const block = buildAutoSeoBlock({ pageUrl, titleText, description });

  // Remove any previous block then add a clean one (near top of head but after GTM/AdSense injections)
  let out = stripOldAutoBlock(html);
  // If there’s a <meta name="description"> outside our block, we leave it as-is; our block defines the canonical one for crawlers.

  // Put the AUTO block right after the first two injected snippets if present, otherwise near top of <head>.
  const headOpenRx = /<head[^>]*>/i;
  if (headOpenRx.test(out)) {
    out = out.replace(headOpenRx, (m) => `${m}\n${block}\n`);
  }
  return out;
}

function processFile(absPath) {
  const original = readFile(absPath);
  if (!/<html[^>]*>/i.test(original)) return null; // skip odd files

  let html = original;

  // Inject GTM (head + body)
  html = injectGTM(html, GTM_ID);

  // Inject AdSense (head)
  html = injectAdSense(html);

  // Inject/refresh SEO block
  html = updateAutoSeo(html, absPath);

  // Only write when changed
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
    // skip any path segment matching beta/backup/backups
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
