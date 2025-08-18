#!/usr/bin/env node
/**
 * Generate sitemap.xml for GitHub Pages site
 * - Excludes /beta, /Beta, /backup, /Backup, /Backups
 * - Maps index.html to root path
 * - Removes excluded URLs if they were present previously
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = process.cwd();
const SITE_URL = (process.env.SITE_URL || "https://www.techability.co.nz").replace(/\/+$/,"");

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    const rel = p.replace(ROOT, "").replace(/\\/g, "/");
    const isExcluded = [/\/beta\//i, /\/backup\//i, /\/backups\//i].some(rx => rx.test(rel + (entry.isDirectory()?"/":"")));
    if (entry.isDirectory()) {
      if (!isExcluded) out.push(...walk(p));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) {
      if (!isExcluded) out.push(p);
    }
  }
  return out;
}

function toUrl(filePath) {
  let rel = path.relative(ROOT, filePath).replace(/\\/g, "/");
  // Clean up leading "./"
  rel = rel.replace(/^\.\//, "");
  // index mapping
  if (rel.toLowerCase().endsWith("/index.html")) {
    rel = rel.slice(0, -"/index.html".length) + "/";
  }
  return `${SITE_URL}/${rel}`.replace(/\/+/g,"/").replace(":/","://");
}

function lastmod(filePath) {
  const stats = fs.statSync(filePath);
  return new Date(stats.mtimeMs).toISOString();
}

const files = walk(ROOT);
const urls = files.map(p => ({ loc: toUrl(p), lastmod: lastmod(p) }));

// Build XML
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod><changefreq>weekly</changefreq><priority>${u.loc.endsWith("/")? "1.0":"0.7"}</priority></url>`).join("\n")}
</urlset>
`;

fs.writeFileSync(path.join(ROOT, "sitemap.xml"), xml, "utf8");
console.log(`Wrote sitemap.xml with ${urls.length} URLs (excluded beta/backup)`);
