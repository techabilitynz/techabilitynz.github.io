#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const cwd = process.cwd();
const BASE_URL = process.env.BASE_URL || "https://www.techability.co.nz";
const OUTPUT_FILE = process.env.OUTPUT_FILE || "sitemap.xml";
const EXCLUDE_DIRS = new Set(
  (process.env.EXCLUDE_DIRS || "beta,backup,node_modules,.git,.github,backups")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
);

function isExcludedDir(seg) {
  return EXCLUDE_DIRS.has(seg);
}

async function walk(dir, out) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    // Skip hidden folders and known excludes
    if (ent.isDirectory()) {
      if (isExcludedDir(ent.name) || ent.name.startsWith(".")) continue;
      await walk(path.join(dir, ent.name), out);
    } else if (ent.isFile()) {
      if (!ent.name.endsWith(".html")) continue;
      // Skip partials that start with underscore
      if (ent.name.startsWith("_")) continue;
      out.push(path.join(dir, ent.name));
    }
  }
}

function toUrl(filePath) {
  let rel = path.relative(cwd, filePath).replace(/\\/g, "/");
  // index.html becomes folder path
  if (rel === "index.html") return BASE_URL + "/";
  if (rel.endsWith("/index.html")) {
    const folder = rel.slice(0, -"/index.html".length);
    return `${BASE_URL}/${folder}/`.replace(/\/+/, "/");
  }
  return `${BASE_URL}/${rel}`.replace(/\/+/, "/");
}

function lastModISO(filePath) {
  try {
    const out = execSync(`git log -1 --format=%cI -- "${filePath}"`, { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    if (out) return out;
  } catch {}
  const stat = fs.statSync(filePath);
  return new Date(stat.mtime).toISOString();
}

function priorityFor(url) {
  // Give home page a bit more weight
  if (url === BASE_URL + "/") return "1.0";
  // index pages get 0.8
  if (url.endsWith("/")) return "0.8";
  return "0.7";
}

const files = [];
await walk(cwd, files);
files.sort();

const urls = files.map(fp => {
  const loc = toUrl(fp);
  const lm = lastModISO(fp);
  const pr = priorityFor(loc);
  return { loc, lm, pr };
});

const header = `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

const body = urls.map(u => {
  return (
`  <url>
    <loc>${u.loc}</loc>
    <lastmod>${u.lm}</lastmod>
    <priority>${u.pr}</priority>
  </url>`
  );
}).join("\n");

const footer = `</urlset>\n`;

const xml = [header, body, footer].join("\n");
await fs.promises.writeFile(path.join(cwd, OUTPUT_FILE), xml, "utf8");

console.log(`Wrote ${OUTPUT_FILE} with ${urls.length} URLs.`);
