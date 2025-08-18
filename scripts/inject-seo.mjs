#!/usr/bin/env node
/**
 * Auto SEO injector (no dependencies).
 * - Updates existing SEO tags where present; adds missing ones.
 * - Normalizes: description, canonical, og:url/title/description/image/site_name/type,
 *   twitter:card/title/description/image.
 * - Keeps explicit "noindex" robots if present (won't override to index).
 * - Idempotent via <!-- AUTO-SEO-INJECT v1 --> markers.
 * - Skips any path containing /beta, /backup, /Backups (case-insensitive).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const ENV = {
  SITE_URL: process.env.SITE_URL || "https://www.techability.co.nz",
  SITE_NAME: process.env.SITE_NAME || "Tech Ability",
  DEFAULT_IMAGE:
    process.env.DEFAULT_IMAGE ||
    "https://i.postimg.cc/SQ6GFs1B/banner-1200-630.jpg",
  SITE_DESC:
    process.env.SITE_DESC ||
    "Christchurch-based tech support and NZ fibre & Hyperfibre internet. Friendly, accessible service for phones, laptops, tablets, and smart homes.",
  FACEBOOK_URL:
    process.env.FACEBOOK_URL || "https://www.facebook.com/TechAbilityCHCH",
};

const EXCLUDE_DIR_RE = /(^|\/)(beta|backup|backups)(\/|$)/i;
const SKIP_FILES = new Set([
  "sitemap.xml",
  "robots.txt",
  "CNAME",
  "404.html",
  "README.md",
  "readme.md",
  "LICENSE",
  "license",
]);

function isHidden(name) {
  return name.startsWith(".") && name !== ".well-known";
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (isHidden(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    const rel = path.relative(repoRoot, abs).replaceAll("\\", "/");
    if (entry.isDirectory()) {
      if (EXCLUDE_DIR_RE.test(`/${rel}/`)) continue;
      walk(abs, out);
    } else if (entry.isFile()) {
      const base = path.basename(rel);
      if (SKIP_FILES.has(base)) continue;
      if (EXCLUDE_DIR_RE.test(`/${rel}`)) continue;
      if (!/\.html?$/i.test(base)) continue;
      out.push(rel);
    }
  }
  return out;
}

function urlFor(relPath) {
  const web = relPath.replace(/\\/g, "/");
  if (/^index\.html?$/i.test(web)) return "/";
  if (/\/index\.html?$/i.test(web)) return `/${web.replace(/\/index\.html?$/i, "/")}`;
  return `/${web}`;
}

function decode(s) {
  return s
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}
function esc(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function getTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decode(m[1].trim()) : null;
}

function getMeta(html, name) {
  const re = new RegExp(
    `<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']*)["'][^>]*>`,
    "i"
  );
  const m = html.match(re);
  return m ? decode(m[1].trim()) : null;
}

function setOrReplaceMetaByName(html, name, content) {
  const re = new RegExp(
    `<meta[^>]*name=["']${name}["'][^>]*>`,
    "ig"
  );
  const tag = `<meta name="${name}" content="${esc(content)}">`;
  if (re.test(html)) {
    // Remove all existing then add one clean version
    html = html.replace(re, "");
    return insertBeforeHeadClose(html, tag);
  }
  return insertBeforeHeadClose(html, tag);
}

function getOg(html, prop) {
  const re = new RegExp(
    `<meta[^>]*property=["']${prop}["'][^>]*content=["']([^"']*)["'][^>]*>`,
    "i"
  );
  const m = html.match(re);
  return m ? decode(m[1].trim()) : null;
}

function removeAllOg(html, keys) {
  for (const k of keys) {
    const re = new RegExp(
      `<meta[^>]*property=["']${k}["'][^>]*>`,
      "ig"
    );
    html = html.replace(re, "");
  }
  return html;
}

function setOg(html, prop, content) {
  const tag = `<meta property="${prop}" content="${esc(content)}">`;
  return insertBeforeHeadClose(html, tag);
}

function getTwitter(html, name) {
  const re = new RegExp(
    `<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']*)["'][^>]*>`,
    "i"
  );
  const m = html.match(re);
  return m ? decode(m[1].trim()) : null;
}
function removeAllTwitter(html, keys) {
  for (const k of keys) {
    const re = new RegExp(
      `<meta[^>]*name=["']${k}["'][^>]*>`,
      "ig"
    );
    html = html.replace(re, "");
  }
  return html;
}
function setTwitter(html, name, content) {
  const tag = `<meta name="${name}" content="${esc(content)}">`;
  return insertBeforeHeadClose(html, tag);
}

function hasNoindex(html) {
  const m = html.match(
    /<meta[^>]*name=["']robots["'][^>]*content=["']([^"']*)["'][^>]*>/i
  );
  if (!m) return false;
  return /\bnoindex\b/i.test(m[1]);
}
function upsertRobots(html) {
  if (hasNoindex(html)) return html; // respect noindex
  const re = /<meta[^>]*name=["']robots["'][^>]*>/i;
  const tag = `<meta name="robots" content="index,follow">`;
  if (re.test(html)) return html.replace(re, tag);
  return insertBeforeHeadClose(html, tag);
}

function upsertCanonical(html, href) {
  const re = /<link[^>]*rel=["']canonical["'][^>]*>/ig;
  const tag = `<link rel="canonical" href="${href}">`;
  if (re.test(html)) {
    html = html.replace(re, "");
  }
  return insertBeforeHeadClose(html, tag);
}

function removeOurBlock(html) {
  return html.replace(
    /<!--\s*AUTO-SEO-INJECT v1\s*-->[\s\S]*?<!--\s*\/AUTO-SEO-INJECT\s*-->/ig,
    ""
  );
}

function insertBeforeHeadClose(html, tag) {
  const idx = html.search(/<\/head>/i);
  if (idx === -1) return html; // no head
  return html.slice(0, idx) + tag + "\n" + html.slice(idx);
}

function insertBlock(html, block) {
  const idx = html.search(/<\/head>/i);
  if (idx === -1) return html;
  return html.slice(0, idx) + block + "\n" + html.slice(idx);
}

function buildBlock({ pageUrl, title, desc }) {
  const fullUrl = `${ENV.SITE_URL.replace(/\/+$/, "")}${pageUrl}`;
  const safeTitle = esc(title || ENV.SITE_NAME);
  const safeDesc = esc(desc || ENV.SITE_DESC);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": ENV.SITE_NAME,
    "url": ENV.SITE_URL,
    "sameAs": [ENV.FACEBOOK_URL],
    "areaServed": "NZ",
  };

  return `<!-- AUTO-SEO-INJECT v1 -->
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(ENV.SITE_NAME)}">
<meta property="og:url" content="${fullUrl}">
<meta property="og:title" content="${safeTitle}">
<meta property="og:description" content="${safeDesc}">
<meta property="og:image" content="${esc(ENV.DEFAULT_IMAGE)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${safeTitle}">
<meta name="twitter:description" content="${safeDesc}">
<meta name="twitter:image" content="${esc(ENV.DEFAULT_IMAGE)}">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<!-- /AUTO-SEO-INJECT -->`;
}

// -------- run --------
const files = walk(repoRoot);
let changed = 0;

for (const rel of files) {
  const abs = path.join(repoRoot, rel);
  let html = fs.readFileSync(abs, "utf8");
  if (!/<\/head>/i.test(html)) continue;

  const pageUrl = urlFor(rel);
  const title =
    getTitle(html) ||
    (pageUrl === "/"
      ? "Tech Ability — clear, friendly tech support"
      : ENV.SITE_NAME);

  // Choose description: prefer page's current description (update its value),
  // else fall back to ENV default.
  const desc = getMeta(html, "description") || ENV.SITE_DESC;

  // 1) Ensure/UPDATE meta description to chosen `desc`
  html = setOrReplaceMetaByName(html, "description", desc);

  // 2) Robots (respect noindex)
  html = upsertRobots(html);

  // 3) Canonical
  const fullUrl = `${ENV.SITE_URL.replace(/\/+$/, "")}${pageUrl}`;
  html = upsertCanonical(html, fullUrl);

  // 4) Remove previous injected block (if any)
  html = removeOurBlock(html);

  // 5) Remove any existing OG/Twitter *we manage* to avoid duplicates
  const ogKeys = [
    "og:url",
    "og:title",
    "og:description",
    "og:image",
    "og:site_name",
    "og:type",
  ];
  html = removeAllOg(html, ogKeys);

  const twKeys = [
    "twitter:card",
    "twitter:title",
    "twitter:description",
    "twitter:image",
  ];
  html = removeAllTwitter(html, twKeys);

  // 6) Insert a fresh, normalized block
  html = insertBlock(html, buildBlock({ pageUrl, title, desc }));

  // 7) Write if changed
  fs.writeFileSync(abs, html.endsWith("\n") ? html : html + "\n", "utf8");
  changed++;
  console.log(`SEO updated: ${rel} -> ${pageUrl}`);
}

console.log(`Done. Files touched: ${changed}`);
