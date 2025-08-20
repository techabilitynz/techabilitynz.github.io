#!/usr/bin/env node
/**
 * Auto SEO & AdSense injector (idempotent)
 * - Upserts <title>, <meta name="description">, canonical
 * - Adds/updates OG + Twitter tags
 * - Inserts JSON-LD (Organization, WebSite, WebPage)
 * - Adds Facebook publisher/see_also if provided
 * - Adds AdSense auto-ads tag (head) when ADSENSE_ID is set
 * - Skips /beta, /backup, /Backups, /node_modules, /.github
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import cheerio from "cheerio";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = process.cwd();

const SITE_URL = (process.env.SITE_URL || "https://example.com").replace(/\/+$/, "");
const SITE_NAME = process.env.SITE_NAME || "My Site";
const DEFAULT_IMAGE = process.env.DEFAULT_IMAGE || `${SITE_URL}/og.png`;
const DEFAULT_DESC = process.env.SITE_DESC || `${SITE_NAME}`;
const FACEBOOK_URL = process.env.FACEBOOK_URL || "";
const ADSENSE_ID = process.env.ADSENSE_ID || "";

const EXCLUDE_DIRS = new Set(["node_modules", ".git", ".github", "beta", "backup", "Backups"]);

// --- utilities ---------------------------------------------------------------

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) out.push(full);
  }
  return out;
}

function relUrlForFile(absPath) {
  let rel = path.relative(REPO_ROOT, absPath).replace(/\\/g, "/"); // windows-safe
  // For "index.html" use folder path as "/" (canonical root) or subfolder path
  if (rel.endsWith("/index.html")) {
    rel = rel.slice(0, -"/index.html".length) + "/";
  } else if (rel === "index.html") {
    rel = "/";
  } else {
    rel = "/" + rel;
  }
  // Collapse "/./" and remove double slashes
  rel = rel.replace(/\/{2,}/g, "/");
  return new URL(rel, SITE_URL).toString();
}

function clampDesc(s) {
  const clean = s.replace(/\s+/g, " ").trim();
  if (clean.length <= 90) return clean;
  if (clean.length <= 160) return clean;
  // try to cut at sentence end before 160
  const slice = clean.slice(0, 160);
  const lastDot = slice.lastIndexOf(". ");
  if (lastDot > 90) return slice.slice(0, lastDot + 1).trim();
  return slice.trim() + "…";
}

function textFromFirst($, selectors) {
  for (const sel of selectors) {
    const t = ($(sel).first().text() || "").replace(/\s+/g, " ").trim();
    if (t) return t;
  }
  return "";
}

// meta/link upsert helpers
function upsertMetaName($, name, content) {
  if (!content) return;
  const el = $(`head meta[name="${name}"]`);
  if (el.length) el.attr("content", content);
  else $("head").append(`\n<meta name="${name}" content="${content}">`);
}

function upsertMetaProp($, property, content) {
  if (!content) return;
  const el = $(`head meta[property="${property}"]`);
  if (el.length) el.attr("content", content);
  else $("head").append(`\n<meta property="${property}" content="${content}">`);
}

function upsertLinkRel($, rel, href) {
  if (!href) return;
  const el = $(`head link[rel="${rel}"]`);
  if (el.length) el.attr("href", href);
  else $("head").append(`\n<link rel="${rel}" href="${href}">`);
}

function ensureTitle($, fallback) {
  const t = ($("head > title").text() || "").trim();
  if (t) return t;
  $("head").prepend(`\n<title>${fallback}</title>`);
  return fallback;
}

function removeOldAutoBlocks(html) {
  return html.replace(/<!--\s*AUTO-SEO-INJECT v\d+\s*-->[\s\S]*?<!--\s*\/AUTO-SEO-INJECT\s*-->/gi, "");
}

// JSON-LD builder
function ensureJsonLd($, { pageName, pageUrl }) {
  // remove any previous our-block to avoid duplicates
  $('script[type="application/ld+json"][data-techability="seo"]').remove();

  const ld = [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "name": SITE_NAME,
      "url": SITE_URL,
      "logo": DEFAULT_IMAGE,
      ...(FACEBOOK_URL ? { "sameAs": [FACEBOOK_URL] } : {}),
      "areaServed": "NZ",
      "knowsAbout": [
        "Fibre broadband",
        "Hyperfibre",
        "Internet provider New Zealand",
        "Wi-Fi help",
        "Smart home setup",
        "Computer support",
        "Phone support"
      ]
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "name": SITE_NAME,
      "url": SITE_URL,
      "inLanguage": "en-NZ",
      "potentialAction": {
        "@type": "SearchAction",
        "target": `${SITE_URL}/search?q={search_term_string}`,
        "query-input": "required name=search_term_string"
      }
    },
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      "name": pageName || SITE_NAME,
      "url": pageUrl
    }
  ];

  $("head").append(
    `\n<script type="application/ld+json" data-techability="seo">${JSON.stringify(ld)}</script>`
  );
}

// AdSense
function ensureAdSense($) {
  if (!ADSENSE_ID) return;
  const srcMatch = `pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_ID}`;

  const hasScript =
    $('head script[src*="pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"]').filter((_, el) => {
      const s = $(el).attr("src") || "";
      return s.includes(ADSENSE_ID);
    }).length > 0;

  const hasMeta = $(`head meta[name="google-adsense-account"][content="${ADSENSE_ID}"]`).length > 0;

  if (!hasMeta) {
    $("head").prepend(`\n<meta name="google-adsense-account" content="${ADSENSE_ID}">`);
  }
  if (!hasScript) {
    $("head").prepend(
      `\n<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_ID}" crossorigin="anonymous"></script>`
    );
  }
}

// main per-file processor
function processHtmlFile(abs) {
  const raw = fs.readFileSync(abs, "utf8");
  const cleaned = removeOldAutoBlocks(raw);
  const $ = cheerio.load(cleaned, { decodeEntities: false });

  // ensure <head> exists
  if ($("head").length === 0) $("html").prepend("<head></head>");
  if ($("body").length === 0) $("html").append("<body></body>");

  // derive canonical + page name
  const canonical = relUrlForFile(abs);
  const h1 = textFromFirst($, ["main h1", "h1", "header h1"]);
  const pageBase = h1 || textFromFirst($, ["title"]) || SITE_NAME;
  const pageTitle = pageBase.trim() === SITE_NAME ? SITE_NAME : `${pageBase}`;
  const title = ensureTitle($, pageTitle);

  // description: keep existing if present; else build from hero/lead/first p
  let desc = ($('head meta[name="description"]').attr("content") || "").trim();
  if (!desc) {
    const firstPara = textFromFirst($, [".lead", "main p", "p", "section p"]);
    desc = clampDesc(firstPara || DEFAULT_DESC);
  } else {
    desc = clampDesc(desc);
  }

  // robots default
  if (!$('head meta[name="robots"]').length) {
    upsertMetaName($, "robots", "index,follow");
  }

  // canonical
  upsertLinkRel($, "canonical", canonical);

  // description
  upsertMetaName($, "description", desc);

  // Open Graph
  upsertMetaProp($, "og:type", "website");
  upsertMetaProp($, "og:site_name", SITE_NAME);
  upsertMetaProp($, "og:url", canonical);
  upsertMetaProp($, "og:title", title);
  upsertMetaProp($, "og:description", desc);
  upsertMetaProp($, "og:image", DEFAULT_IMAGE);

  // Twitter
  upsertMetaName($, "twitter:card", "summary_large_image");
  upsertMetaName($, "twitter:title", title);
  upsertMetaName($, "twitter:description", desc);
  upsertMetaName($, "twitter:image", DEFAULT_IMAGE);

  // Facebook extras
  if (FACEBOOK_URL) {
    upsertMetaProp($, "article:publisher", FACEBOOK_URL);
    upsertMetaProp($, "og:see_also", FACEBOOK_URL);
  }

  // JSON-LD
  ensureJsonLd($, { pageName: title, pageUrl: canonical });

  // AdSense
  ensureAdSense($);

  const out = $.html();

  if (out !== raw) {
    fs.writeFileSync(abs, out);
    console.log(`Updated SEO: ${path.relative(REPO_ROOT, abs)}`);
    return true;
  } else {
    return false;
  }
}

// run -------------------------------------------------------------------------
const htmlFiles = walk(REPO_ROOT);
let changed = 0;
for (const f of htmlFiles) {
  try {
    if (processHtmlFile(f)) changed++;
  } catch (e) {
    console.error(`Failed ${f}:`, e.message);
  }
}

console.log(`Done. Updated ${changed}/${htmlFiles.length} HTML files.`);
