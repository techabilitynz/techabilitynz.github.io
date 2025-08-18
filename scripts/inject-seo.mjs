#!/usr/bin/env node
/**
 * Auto SEO injector (no dependencies).
 * - Runs on every push & nightly.
 * - Upserts canonical, OG, Twitter, robots, JSON-LD.
 * - Uses page <title> and existing <meta name="description"> when available.
 * - Skips /beta, /backup, /Backups (any case) anywhere in the path.
 * - Idempotent via <!-- AUTO-SEO-INJECT v1 --> markers.
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
  if (/^index\.html$/i.test(web)) return "/";
  if (/\/index\.html$/i.test(web)) return `/${web.replace(/\/index\.html$/i, "/")}`;
  return `/${web}`;
}

function getTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decode(m[1].trim()) : null;
}

function getDescription(html) {
  const m = html.match(
    /<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i
  );
  return m ? decode(m[1].trim()) : null;
}

function decode(s) {
  return s.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&#39;", "'");
}
function esc(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function upsertSingleTag(html, selectorRe, makeTag) {
  const re = new RegExp(selectorRe, "i");
  if (re.test(html)) {
    return html.replace(re, makeTag());
  }
  // insert before </head>
  const headClose = html.search(/<\/head>/i);
  if (headClose === -1) return html; // no head? skip
  return html.slice(0, headClose) + makeTag() + "\n" + html.slice(headClose);
}

function removeBlock(html) {
  return html.replace(
    /<!--\s*AUTO-SEO-INJECT v1\s*-->[\s\S]*?<!--\s*\/AUTO-SEO-INJECT\s*-->/i,
    ""
  );
}

function injectBlock(html, block) {
  const headClose = html.search(/<\/head>/i);
  if (headClose === -1) return html;
  return html.slice(0, headClose) + block + "\n" + html.slice(headClose);
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
<link rel="canonical" href="${fullUrl}">
<meta name="robots" content="index,follow">
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

const files = walk(repoRoot);
let changed = 0;

for (const rel of files) {
  const abs = path.join(repoRoot, rel);
  let html = fs.readFileSync(abs, "utf8");

  // Skip if no </head>
  if (!/<\/head>/i.test(html)) continue;

  const pageUrl = urlFor(rel);
  const title =
    getTitle(html) ||
    (pageUrl === "/" ? "Tech Ability — clear, friendly tech support" : `${ENV.SITE_NAME}`);
  const desc = getDescription(html) || ENV.SITE_DESC;

  // Keep any existing <meta name="description"> (do not overwrite),
  // but if it's missing, add one.
  if (!getDescription(html)) {
    html = upsertSingleTag(
      html,
      `<meta[^>]*name=["']description["'][^>]*>`,
      () => `<meta name="description" content="${esc(desc)}">`
    );
  }

  // Canonical: upsert
  const fullUrl = `${ENV.SITE_URL.replace(/\/+$/, "")}${pageUrl}`;
  html = upsertSingleTag(
    html,
    `<link[^>]*rel=["']canonical["'][^>]*>`,
    () => `<link rel="canonical" href="${fullUrl}">`
  );

  // Replace our previous block (if any), then inject fresh one
  html = removeBlock(html);
  html = injectBlock(html, buildBlock({ pageUrl, title, desc }));

  fs.writeFileSync(abs, html, "utf8");
  changed++;
  console.log(`SEO injected: ${rel} -> ${pageUrl}`);
}

console.log(`Done. Files updated: ${changed}`);
