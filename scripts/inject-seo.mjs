#!/usr/bin/env node
/**
 * Inject/refresh SEO tags for all HTML files.
 * - Title / Description
 * - Canonical, OG, Twitter
 * - JSON-LD (Organization, WebSite with SearchAction, Service: Fibre & Hyperfibre)
 * - Adds Facebook page to sameAs + article:publisher
 *
 * Controlled via env:
 *   SITE_URL       e.g. https://www.techability.co.nz
 *   SITE_NAME      e.g. Tech Ability
 *   DEFAULT_IMAGE  e.g. hero image URL
 *   SITE_DESC      default meta description
 *   FACEBOOK_URL   e.g. https://www.facebook.com/TechAbilityCHCH
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const SITE_URL = process.env.SITE_URL || "https://www.example.com";
const SITE_NAME = process.env.SITE_NAME || "Your Site";
const DEFAULT_IMAGE = process.env.DEFAULT_IMAGE || `${SITE_URL}/og-default.jpg`;
const SITE_DESC = process.env.SITE_DESC || "Default site description.";
const FACEBOOK_URL = process.env.FACEBOOK_URL || "";

const HTML_FILES = walkHtml(ROOT).filter(p => !p.includes("node_modules") && !p.includes(".git/"));

function walkHtml(startDir) {
  const results = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip typical build/backup/beta folders by default
        const skip = ["/beta", "/Beta", "/backup", "/Backup", "/Backups", "/.git", "/node_modules"].some(seg => p.includes(seg));
        if (!skip) walk(p);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) {
        results.push(p);
      }
    }
  }
  walk(startDir);
  return results;
}

function readFile(p) {
  return fs.readFileSync(p, "utf8");
}
function writeFile(p, data) {
  fs.writeFileSync(p, data);
}

function stripBom(s) {
  return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s;
}

function ensureTag(head, tag) {
  // Inserts tag if not already present (basic contains check by name/property/script type/id)
  const keyMatch = tag.match(/(name|property|rel|id|type)="([^"]+)"/i);
  const key = keyMatch ? keyMatch[0] : tag.slice(0, 60);
  if (!head.includes(key)) {
    return head + "\n  " + tag;
  }
  return head;
}

function setOrReplaceMeta(head, selectorRegex, newTag) {
  const re = new RegExp(selectorRegex, "i");
  if (re.test(head)) {
    return head.replace(new RegExp(`<meta[^>]+${selectorRegex}[^>]*>`, "i"), newTag);
  } else {
    return ensureTag(head, newTag);
  }
}

function setOrReplaceLink(head, rel, href) {
  const re = new RegExp(`<link[^>]+rel=["']${rel}["'][^>]*>`, "i");
  const newTag = `<link rel="${rel}" href="${href}">`;
  if (re.test(head)) {
    return head.replace(re, newTag);
  } else {
    return ensureTag(head, newTag);
  }
}

function normalizeUrl(filePath) {
  // determine URL path from file path relative to repo root
  let rel = path.relative(ROOT, filePath).replace(/\\/g, "/");
  if (rel.toLowerCase().endsWith("/index.html")) {
    rel = rel.slice(0, -"/index.html".length) + "/";
  } else if (rel.toLowerCase().endsWith(".html")) {
    // leave as foo.html
  }
  return (SITE_URL.replace(/\/+$/,"") + "/" + rel.replace(/^\/+/, ""))
    .replace(/\/+/g, "/")
    .replace(":/", "://");
}

function buildJsonLd(pageUrl, pageTitle) {
  const sameAs = [];
  if (FACEBOOK_URL) sameAs.push(FACEBOOK_URL);

  const org = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": SITE_NAME,
    "url": SITE_URL,
    "logo": DEFAULT_IMAGE,
    "sameAs": sameAs,
    "areaServed": "NZ",
    "knowsAbout": [
      "Fibre broadband", "Hyperfibre", "Internet provider New Zealand",
      "Wi‑Fi help", "Smart home setup", "Computer support", "Phone support"
    ]
  };

  const website = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": SITE_NAME,
    "url": SITE_URL,
    "potentialAction": {
      "@type": "SearchAction",
      "target": `${SITE_URL}/search?q={search_term_string}`,
      "query-input": "required name=search_term_string"
    },
    "inLanguage": "en-NZ"
  };

  const fibreService = {
    "@context": "https://schema.org",
    "@type": "Service",
    "name": "Fibre broadband (NZ)",
    "provider": { "@type": "Organization", "name": SITE_NAME, "url": SITE_URL },
    "areaServed": "New Zealand",
    "serviceType": "Internet Service",
    "url": `${SITE_URL}/internet.html`
  };
  const hyperService = {
    "@context": "https://schema.org",
    "@type": "Service",
    "name": "Hyperfibre internet (NZ)",
    "provider": { "@type": "Organization", "name": SITE_NAME, "url": SITE_URL },
    "areaServed": "New Zealand",
    "serviceType": "Internet Service",
    "url": `${SITE_URL}/internet.html#hyperfibre`
  };

  const webPage = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "name": pageTitle || SITE_NAME,
    "url": pageUrl
  };

  return [
    org, website, fibreService, hyperService, webPage
  ];
}

function extractTitle(html) {
  const m = html.match(/<title>([\s\S]*?)<\/title>/i);
  return m ? m[1].trim() : "";
}
function extractH1(html) {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return m ? m[1].replace(/<[^>]*>/g,"").trim() : "";
}

let changed = 0;

for (const file of HTML_FILES) {
  let html = stripBom(readFile(file));

  let headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  if (!headMatch) continue;
  let head = headMatch[1];

  // Title
  let title = extractTitle(html);
  if (!title) {
    const h1 = extractH1(html);
    title = h1 ? `${h1} – ${SITE_NAME}` : SITE_NAME;
    const before = head;
    head = ensureTag(head, `<title>${title}</title>`);
    if (before !== head) changed++;
  }

  // Description
  head = setOrReplaceMeta(head, `name=["']description["']`, `<meta name="description" content="${SITE_DESC}">`);

  // Canonical
  const pageUrl = normalizeUrl(file);
  head = setOrReplaceLink(head, "canonical", pageUrl);

  // OG / Twitter
  head = setOrReplaceMeta(head, `property=["']og:title["']`, `<meta property="og:title" content="${title || SITE_NAME}">`);
  head = setOrReplaceMeta(head, `property=["']og:description["']`, `<meta property="og:description" content="${SITE_DESC}">`);
  head = setOrReplaceMeta(head, `property=["']og:type["']`, `<meta property="og:type" content="website">`);
  head = setOrReplaceMeta(head, `property=["']og:url["']`, `<meta property="og:url" content="${pageUrl}">`);
  head = setOrReplaceMeta(head, `property=["']og:image["']`, `<meta property="og:image" content="${DEFAULT_IMAGE}">`);
  head = setOrReplaceMeta(head, `property=["']og:site_name["']`, `<meta property="og:site_name" content="${SITE_NAME}">`);
  if (FACEBOOK_URL) {
    head = setOrReplaceMeta(head, `property=["']article:publisher["']`, `<meta property="article:publisher" content="${FACEBOOK_URL}">`);
    // also add og:see_also once
    if (!/property=["']og:see_also["']/.test(head)) {
      head = ensureTag(head, `<meta property="og:see_also" content="${FACEBOOK_URL}">`);
    }
  }

  // Twitter
  head = setOrReplaceMeta(head, `name=["']twitter:card["']`, `<meta name="twitter:card" content="summary_large_image">`);
  head = setOrReplaceMeta(head, `name=["']twitter:title["']`, `<meta name="twitter:title" content="${title || SITE_NAME}">`);
  head = setOrReplaceMeta(head, `name=["']twitter:description["']`, `<meta name="twitter:description" content="${SITE_DESC}">`);
  head = setOrReplaceMeta(head, `name=["']twitter:image["']`, `<meta name="twitter:image" content="${DEFAULT_IMAGE}">`);

  // JSON-LD
  const JSONLD_MARK = `data-techability="seo"`;
  const jsonldRegex = new RegExp(`<script[^>]*type=["']application/ld\\+json["'][^>]*${JSONLD_MARK}[^>]*>[\\s\\S]*?<\\/script>`, "i");
  const pageTitle = extractTitle(html) || extractH1(html) || SITE_NAME;
  const jsonLdPayload = buildJsonLd(pageUrl, pageTitle);
  const jsonLdTag = `<script type="application/ld+json" ${JSONLD_MARK}>${JSON.stringify(jsonLdPayload)}</script>`;

  if (jsonldRegex.test(head)) {
    head = head.replace(jsonldRegex, jsonLdTag);
  } else {
    head = ensureTag(head, jsonLdTag);
  }

  // Replace head back
  const newHtml = html.replace(/<head[^>]*>[\s\S]*?<\/head>/i, `<head>\n${head}\n</head>`);

  if (newHtml !== html) {
    writeFile(file, newHtml);
    changed++;
  }
}

console.log(`SEO injection complete. Files updated: ${changed}`);
