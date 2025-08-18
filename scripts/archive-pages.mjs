// Archive pages to Wayback Machine and archive.today/.ph
// Node 20+ required

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const SITE_ROOT = process.env.SITE_ROOT || "https://example.com";
const SITEMAP_PATH = process.env.SITEMAP_PATH || "sitemap.xml";
const INCLUDE_URLS = (process.env.INCLUDE_URLS || "").split(",").map(s => s.trim()).filter(Boolean);
const EXCLUDE_PATTERNS = (process.env.EXCLUDE_PATTERNS || "")
  .split(",").map(s => s.trim()).filter(Boolean)
  .map(rx => new RegExp(rx, "i"));

const WAYBACK_ENABLED = String(process.env.WAYBACK_ENABLED || "true") === "true";
const ARCHIVE_TODAY_ENABLED = String(process.env.ARCHIVE_TODAY_ENABLED || "true") === "true";

function log(...args){ console.log("[archive]", ...args); }
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
function isExcluded(urlPath){ return EXCLUDE_PATTERNS.some(rx => rx.test(urlPath)); }
function toUrl(filePath){
  const rel = filePath.replace(/^\.?\//, "").replace(/\\/g, "/");
  return new URL("/" + rel, SITE_ROOT).toString();
}

function crawlHtmlFiles(dir="."){
  const out = [];
  function walk(d){
    for (const e of fs.readdirSync(d, { withFileTypes: true })){
      const p = path.join(d, e.name);
      const rel = p.replace(/^\.?\//, "").replace(/\\/g, "/");
      if (rel.startsWith(".git/")) continue;
      if (/^beta\//i.test(rel) || /^backup\//i.test(rel) || /^Backups?\//i.test(rel)) continue;
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.toLowerCase().endsWith(".html")) out.push(p);
    }
  }
  walk(dir);
  return out;
}

function parseSitemap(file){
  try{
    const xml = fs.readFileSync(file, "utf8");
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/gi)].map(m => m[1].trim());
    return locs;
  }catch{ return []; }
}

function unique(arr){ return Array.from(new Set(arr)); }
function normalize(url){ return url; }

async function saveToWayback(url){
  try{
    const res = await fetch("https://web.archive.org/save", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ url })
    });
    const contentLoc = res.headers.get("content-location");
    const location = res.headers.get("location");
    const snapshot = contentLoc ? ("https://web.archive.org" + contentLoc) : location;
    log("Wayback:", res.status, snapshot || "");
    return { ok: res.ok, snapshot };
  }catch(e){
    log("Wayback error:", e.message);
    return { ok: false };
  }
}

const ARCHIVE_HOSTS = ["https://archive.today","https://archive.ph","https://archive.vn","https://archive.is"];

async function saveToArchiveToday(url){
  for (const host of ARCHIVE_HOSTS){
    try{
      const submit = host + "/submit/";
      const res = await fetch(submit, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ url })
      });
      const refresh = res.headers.get("refresh") || res.headers.get("Refresh");
      const location = res.headers.get("location") || res.headers.get("Location");
      let snapshot = "";
      if (location) snapshot = new URL(location, host).toString();
      else if (refresh){
        const m = refresh.match(/url=(\S+)/i);
        if (m) snapshot = new URL(m[1], host).toString();
      }
      log("archive.today:", host, res.status, snapshot || "");
      await sleep(2500);
      if (res.ok) return { ok: true, snapshot };
    }catch(e){
      log("archive.today error:", host, e.message);
    }
  }
  return { ok: false };
}

function changedHtmlFiles(){
  try{
    const baseRef = process.env.GITHUB_BASE_REF;
    const diffRange = baseRef ? `origin/${baseRef}...HEAD` : "HEAD~1..HEAD";
    const r = spawnSync("git", ["diff", "--name-only", diffRange, "--", "*.html"], { encoding: "utf8" });
    if (r.status === 0) return r.stdout.split("\n").map(s => s.trim()).filter(Boolean);
  }catch{}
  return [];
}

(async function main(){
  const urls = new Set();

  for (const u of parseSitemap(SITEMAP_PATH)){
    try{
      const rel = new URL(u).pathname;
      if (!isExcluded(rel)) urls.add(normalize(u));
    }catch{}
  }

  for (const f of crawlHtmlFiles(".")){
    const u = toUrl(f);
    try{
      const rel = new URL(u).pathname;
      if (!isExcluded(rel)) urls.add(normalize(u));
    }catch{}
  }

  for (const u of INCLUDE_URLS){
    try{
      const rel = new URL(u).pathname;
      if (!isExcluded(rel)) urls.add(normalize(u));
    }catch{}
  }

  const changed = changedHtmlFiles();
  const changedUrls = changed.map(toUrl).filter(u => {
    try{ return !isExcluded(new URL(u).pathname); }catch{ return false; }
  });

  const allUrls = unique([...changedUrls, ...urls]);
  if (allUrls.length === 0){
    log("No URLs to archive.");
    return;
  }
  log("Total URLs to archive:", allUrls.length);

  for (const u of allUrls){
    log("Archiving:", u);
    if (WAYBACK_ENABLED){
      await saveToWayback(u);
      await sleep(2000);
    }
    if (ARCHIVE_TODAY_ENABLED){
      await saveToArchiveToday(u);
    }
  }
  log("Done.");
})().catch(e => { console.error(e); process.exit(1); });
