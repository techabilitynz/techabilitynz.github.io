#!/usr/bin/env node
/**
 * Auto SEO injector (content-aware descriptions).
 * - Generates a good per-page <meta name="description"> from the page content.
 * - Updates/normalizes canonical, OG, Twitter, robots (respects existing noindex).
 * - Idempotent via <!-- AUTO-SEO-INJECT v1 --> markers.
 * - Skips /beta, /backup, /Backups (any case).
 * - Dependency-free (Node 18+).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

// -------- ENV defaults --------
const ENV = {
  SITE_URL: process.env.SITE_URL || "https://www.techability.co.nz",
  SITE_NAME: process.env.SITE_NAME || "Tech Ability",
  DEFAULT_IMAGE:
    process.env.DEFAULT_IMAGE ||
    "https://i.postimg.cc/SQ6GFs1B/banner-1200-630.jpg",
  SITE_DESC:
    process.env.SITE_DESC ||
    "Tech Ability Internet for New Zealand with Christchurch support — plus friendly, accessible tech help for phones, laptops, tablets and smart homes.",
  FACEBOOK_URL:
    process.env.FACEBOOK_URL || "https://www.facebook.com/TechAbilityCHCH",
};

// -------- helpers --------
const EXCLUDE_DIR_RE = /(^|\/)(beta|backup|backups)(\/|$)/i;
const SKIP_FILES = new Set([
  "sitemap.xml",
  "robots.txt",
  "CNAME",
  "README.md",
  "readme.md",
  "LICENSE",
  "license",
]);

function isHidden(n) {
  return n.startsWith(".") && n !== ".well-known";
}

function walk(dir, out = []) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (isHidden(d.name)) continue;
    const abs = path.join(dir, d.name);
    const rel = path.relative(ROOT, abs).replaceAll("\\", "/");
    if (d.isDirectory()) {
      if (EXCLUDE_DIR_RE.test(`/${rel}/`)) continue;
      walk(abs, out);
    } else if (d.isFile()) {
      const base = path.basename(rel);
      if (SKIP_FILES.has(base)) continue;
      if (!/\.html?$/i.test(base)) continue;
      if (EXCLUDE_DIR_RE.test(`/${rel}`)) continue;
      out.push(rel);
    }
  }
  return out;
}

function pageUrl(rel) {
  const web = rel.replace(/\\/g, "/");
  if (/^index\.html?$/i.test(web)) return "/";
  if (/\/index\.html?$/i.test(web)) return `/${web.replace(/\/index\.html?$/i, "/")}`;
  return `/${web}`;
}

function dec(s) {
  return s
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}
function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
function stripTags(s) {
  return dec(
    s
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}
function pick(...vals) {
  for (const v of vals) if (v && String(v).trim()) return String(v).trim();
  return "";
}
function clampDesc(s, min = 120, max = 165) {
  let t = (s || "").replace(/\s+/g, " ").trim();
  if (!t) return t;
  if (t.length <= max && t.length >= min) return t;

  // try sentence boundary before max
  if (t.length > max) {
    const slice = t.slice(0, max + 1);
    const lastStop = Math.max(
      slice.lastIndexOf(". "),
      slice.lastIndexOf("! "),
      slice.lastIndexOf("? ")
    );
    if (lastStop > min * 0.6) {
      t = slice.slice(0, lastStop + 1).trim();
    } else {
      t = t.slice(0, max - 1).trim() + "…";
    }
  }
  // if still short, leave as is (Google may expand)
  return t;
}

// -------- extractors --------
function getBetween(html, re, group = 1) {
  const m = html.match(re);
  return m ? dec(m[group].trim()) : "";
}
function allBetween(html, re, group = 1, limit = 6) {
  const out = [];
  let m;
  while ((m = re.exec(html)) && out.length < limit) {
    out.push(dec(m[group].trim()));
  }
  return out;
}
function getTitle(html) {
  return getBetween(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
}
function getMeta(html, name) {
  const m = html.match(
    new RegExp(
      `<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']+)["'][^>]*>`,
      "i"
    )
  );
  return m ? dec(m[1]) : "";
}
function hasNoindex(html) {
  const m = html.match(
    /<meta[^>]*name=["']robots["'][^>]*content=["']([^"']+)["'][^>]*>/i
  );
  return m ? /\bnoindex\b/i.test(m[1]) : false;
}

// Gentle selector-ish regexes (good enough for static pages)
function texts(html, selector) {
  switch (selector) {
    case "h1":
      return allBetween(html, /<h1[^>]*>([\s\S]*?)<\/h1>/gi).map(stripTags);
    case ".display-5":
      return allBetween(
        html,
        /<[^>]*class=["'][^"']*\bdisplay-5\b[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/gi
      ).map(stripTags);
    case ".lead":
      return allBetween(
        html,
        /<p[^>]*class=["'][^"']*\blead\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/gi
      ).map(stripTags);
    case "p":
      return allBetween(html, /<p[^>]*>([\s\S]*?)<\/p>/gi).map(stripTags);
    default:
      return [];
  }
}

function detectSpeeds(text) {
  const speeds = Array.from(
    new Set(
      (text.match(/\b\d{2,4}\s*Mbps\b/gi) || []).map((s) =>
        s.replace(/\s+/g, " ").toUpperCase()
      )
    )
  );
  const hasHyper = /hyperfibre|hyperfiber/i.test(text);
  return { speeds, hasHyper };
}

function detectContactBits(html) {
  const phone =
    getBetween(html, /(tel:|tel&#58;|tel&#x3A;)\+?([0-9 \-\(\)]{6,})/i, 2) ||
    dec(
      (html.match(/>\s*([+()0-9 \-]{6,})\s*</) || [])[1] || ""
    );
  const mail = getBetween(html, /(mailto:)([^"']+)/i, 2);
  return {
    phone: (phone || "").replace(/\s+/g, " ").trim(),
    email: (mail || "").trim(),
  };
}

function computeDescription(rel, html) {
  const url = pageUrl(rel);
  const title = pick(getTitle(html));
  const h1 = pick(...texts(html, "h1"));
  const display5 = pick(...texts(html, ".display-5"));
  const lead = pick(...texts(html, ".lead"));
  const firstP = pick(...texts(html, "p"));
  const bigText = [h1, display5, lead, firstP].filter(Boolean).join(" · ");
  const { speeds, hasHyper } = detectSpeeds(html + " " + bigText);
  const lower = (title + " " + h1 + " " + bigText).toLowerCase();

  // Page-specific templates
  if (/contact/i.test(rel) || /\/contact(\.html?)?$/i.test(url)) {
    const { phone, email } = detectContactBits(html);
    let base =
      "Contact Tech Ability — friendly, accessible support for Christchurch & NZ.";
    if (phone) base += ` Call or text ${phone}.`;
    if (email) base += ` Email ${email}.`;
    return clampDesc(base);
  }

  if (/internet/i.test(rel) || /\/internet(\.html?)?$/i.test(url)) {
    const speedBit = speeds.length
      ? ` Plans up to ${speeds.sort((a, b) => parseInt(b) - parseInt(a))[0]}`
      : " Fast Fibre & Hyperfibre plans";
    let base = `Tech Ability Internet for NZ with Christchurch support.${speedBit}. Simple pricing, ${hasHyper ? "symmetric Hyperfibre" : "optional modem hire"}, and in-browser speed test.`;
    return clampDesc(base);
  }

  if (/index\.html?$/i.test(rel) || url === "/") {
    let base =
      "Tech Ability — clear, friendly tech support in Christchurch & across NZ: device setup, computer maintenance, smart homes, plus Fibre & Hyperfibre internet.";
    return clampDesc(base);
  }

  // Generic: build from page content
  const brandTail =
    " Tech Ability — Christchurch support & nationwide internet and tech help.";
  const content = stripTags(bigText || title || firstP || ENV.SITE_DESC);
  let base = content;
  // If content too short or generic, use site desc
  if (!base || base.length < 60) base = ENV.SITE_DESC;
  // Sprinkle in speeds/offer if relevant
  if (speeds.length) base += ` Plans up to ${speeds[0]}.`;
  if (hasHyper && !/hyperfibre/i.test(base)) base += " Hyperfibre available.";
  // Ensure brand/location presence
  if (!/tech ability/i.test(base)) base += brandTail;

  return clampDesc(base);
}

// -------- tag writers --------
function insertBeforeHeadClose(html, tag) {
  const idx = html.search(/<\/head>/i);
  if (idx === -1) return html;
  return html.slice(0, idx) + tag + "\n" + html.slice(idx);
}
function insertBlock(html, block) {
  const idx = html.search(/<\/head>/i);
  if (idx === -1) return html;
  return html.slice(0, idx) + block + "\n" + html.slice(idx);
}
function removeOurBlock(html) {
  return html.replace(
    /<!--\s*AUTO-SEO-INJECT v1\s*-->[\s\S]*?<!--\s*\/AUTO-SEO-INJECT\s*-->/gi,
    ""
  );
}
function setOrReplaceMetaByName(html, name, content) {
  const re = new RegExp(`<meta[^>]*name=["']${name}["'][^>]*>`, "ig");
  const tag = `<meta name="${name}" content="${esc(content)}">`;
  if (re.test(html)) html = html.replace(re, "");
  return insertBeforeHeadClose(html, tag);
}
function upsertCanonical(html, href) {
  const re = /<link[^>]*rel=["']canonical["'][^>]*>/gi;
  const tag = `<link rel="canonical" href="${href}">`;
  if (re.test(html)) html = html.replace(re, "");
  return insertBeforeHeadClose(html, tag);
}
function robotsRespect(html) {
  if (hasNoindex(html)) return html; // keep author choice
  const re = /<meta[^>]*name=["']robots["'][^>]*>/i;
  const tag = `<meta name="robots" content="index,follow">`;
  if (re.test(html)) return html.replace(re, tag);
  return insertBeforeHeadClose(html, tag);
}
function removeAllOg(html, keys) {
  for (const k of keys) {
    html = html.replace(
      new RegExp(`<meta[^>]*property=["']${k}["'][^>]*>`, "ig"),
      ""
    );
  }
  return html;
}
function removeAllTwitter(html, keys) {
  for (const k of keys) {
    html = html.replace(
      new RegExp(`<meta[^>]*name=["']${k}["'][^>]*>`, "ig"),
      ""
    );
  }
  return html;
}
function buildOgTwBlock({ pageUrl, title, description }) {
  const fullUrl = `${ENV.SITE_URL.replace(/\/+$/, "")}${pageUrl}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: ENV.SITE_NAME,
    url: ENV.SITE_URL,
    sameAs: [ENV.FACEBOOK_URL],
    areaServed: "NZ",
  };
  return `<!-- AUTO-SEO-INJECT v1 -->
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(ENV.SITE_NAME)}">
<meta property="og:url" content="${esc(fullUrl)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(ENV.DEFAULT_IMAGE)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(ENV.DEFAULT_IMAGE)}">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<!-- /AUTO-SEO-INJECT -->`;
}

// -------- main --------
const files = walk(ROOT);
let touched = 0;

for (const rel of files) {
  const abs = path.join(ROOT, rel);
  let html = fs.readFileSync(abs, "utf8");
  if (!/<\/head>/i.test(html)) continue;

  const pUrl = pageUrl(rel);
  const title =
    getBetween(html, /<title[^>]*>([\s\S]*?)<\/title>/i) ||
    (pUrl === "/" ? "Tech Ability — clear, friendly tech support" : ENV.SITE_NAME);

  // Generate a GOOD page-specific description from content
  const generatedDesc = computeDescription(rel, html);

  // 1) description (always normalize to our generated one)
  html = setOrReplaceMetaByName(html, "description", generatedDesc);

  // 2) robots
  html = robotsRespect(html);

  // 3) canonical
  const canonical = `${ENV.SITE_URL.replace(/\/+$/, "")}${pUrl}`;
  html = upsertCanonical(html, canonical);

  // 4) replace prior injected block & any OG/Twitter we manage
  html = removeOurBlock(html);
  html = removeAllOg(html, [
    "og:url",
    "og:title",
    "og:description",
    "og:image",
    "og:site_name",
    "og:type",
  ]);
  html = removeAllTwitter(html, [
    "twitter:card",
    "twitter:title",
    "twitter:description",
    "twitter:image",
  ]);

  // 5) insert clean OG/Twitter/JSON-LD block
  html = insertBlock(html, buildOgTwBlock({ pageUrl: pUrl, title, description: generatedDesc }));

  fs.writeFileSync(abs, html.endsWith("\n") ? html : html + "\n", "utf8");
  touched++;
  console.log(`SEO updated: ${rel} → ${pUrl}`);
}

console.log(`Done. Files touched: ${touched}`);
