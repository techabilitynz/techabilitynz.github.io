// scripts/generate-sitemap.mjs
// Generate sitemap.xml for GitHub Pages, excluding beta/backup/backups (any case)
// and purging any such entries if they existed in the previous sitemap.

import { promises as fs } from "node:fs";
import path from "node:path";

const REPO_ROOT  = process.env.GITHUB_WORKSPACE || process.cwd();
const BASE_URL   = (process.env.BASE_URL || "https://www.techability.co.nz").replace(/\/+$/, "");
const OUTPUT_FILE= path.resolve(REPO_ROOT, process.env.OUTPUT_FILE || "sitemap.xml");

// Case-insensitive dir names to exclude (as path segments)
const EXCLUDE_SEGMENTS = [/^beta$/i, /^backup$/i, /^backups$/i, /^node_modules$/i, /^\./];

// Include only HTML pages
const INCLUDE_EXT = new Set([".html", ".htm"]);

// Test a URL path (like "/Backups/foo/index.html") for exclusion
const isExcludedUrlPath = (urlPath) => /(\/|^)(beta|backup|backups)(\/|$)/i.test(urlPath);

// For filesystem dirs: exclude if any segment matches EXCLUDE_SEGMENTS
function isExcludedDir(absPath) {
  const parts = absPath
    .slice(REPO_ROOT.length)
    .split(path.sep)
    .filter(Boolean);
  return parts.some(seg => EXCLUDE_SEGMENTS.some(rx => rx.test(seg)));
}

async function* walk(dir) {
  if (isExcludedDir(dir)) return;

  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    const abs = path.join(dir, ent.name);

    if (ent.isDirectory()) {
      if (isExcludedDir(abs)) continue;
      yield* walk(abs);
      continue;
    }
    if (!ent.isFile()) continue;

    const ext = path.extname(ent.name).toLowerCase();
    if (INCLUDE_EXT.has(ext)) {
      if (isExcludedDir(abs)) continue;
      yield abs;
    }
  }
}

function toUrlPath(absFile) {
  const rel = path.relative(REPO_ROOT, absFile).split(path.sep).join("/");
  // Map index.html to folder slash
  if (/\/?index\.html?$/i.test(rel)) {
    const dir = rel.replace(/\/?index\.html?$/i, "");
    return `/${dir}`.replace(/\/+$/, "/");
  }
  return `/${rel}`;
}

function buildXml(urls) {
  const now = new Date().toISOString();
  const lines = [...urls]
    .sort()
    .map((loc) => `  <url>
    <loc>${BASE_URL}${loc}</loc>
    <changefreq>weekly</changefreq>
    <priority>${loc === "/" ? "1.0" : "0.7"}</priority>
    <lastmod>${now}</lastmod>
  </url>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Auto-generated. Do not edit manually. -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${lines}
</urlset>
`;
}

async function readExistingLocs(file) {
  try {
    const xml = await fs.readFile(file, "utf8");
    const locs = [];
    const re = /<loc>\s*([^<]+?)\s*<\/loc>/gi;
    let m;
    while ((m = re.exec(xml))) {
      try {
        const u = new URL(m[1]);
        locs.push(u.pathname || "/");
      } catch {
        // If it's not an absolute URL, try to treat it as a path
        locs.push(m[1].replace(/^https?:\/\/[^/]+/i, ""));
      }
    }
    return locs;
  } catch {
    return [];
  }
}

(async () => {
  // Crawl repo -> build new URL set
  const urls = new Set();
  for await (const file of walk(REPO_ROOT)) {
    const urlPath = toUrlPath(file);
    if (isExcludedUrlPath(urlPath)) continue; // extra safety
    urls.add(urlPath);
  }

  // Ensure root "/" when index.html exists at repo root
  try {
    await fs.access(path.resolve(REPO_ROOT, "index.html"));
    urls.add("/");
  } catch {}

  // Read old sitemap (if any) and report what would be purged
  const oldLocs = await readExistingLocs(OUTPUT_FILE);
  const purged = oldLocs.filter(isExcludedUrlPath);
  if (purged.length) {
    console.log("⚠️  Removing excluded URLs that were present previously:");
    for (const p of purged) console.log("   - " + p);
  }

  // Write fresh sitemap (excluded entries will no longer appear)
  const xml = buildXml(urls);
  await fs.writeFile(OUTPUT_FILE, xml, "utf8");
  console.log(`✅ Wrote sitemap: ${OUTPUT_FILE} (${urls.size} URLs)`);
})();
