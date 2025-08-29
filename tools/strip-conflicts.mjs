// tools/strip-conflicts.mjs
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "vendor"]);

const rxBlock = /<<<<<<<[\s\S]*?>>>>>>>[^\n]*\n?/g;     // whole blocks
const rxLines = /^(<<<<<<<|=======|>>>>>>>) .*$\n?/gm;  // stray lines

let changed = 0;

walk(ROOT);

function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      walk(path.join(dir, ent.name));
      continue;
    }
    if (!/\.(html|css|js|mjs|json|md)$/i.test(ent.name)) continue;
    const file = path.join(dir, ent.name);
    let s = fs.readFileSync(file, "utf8");
    const before = s;
    s = s.replace(rxBlock, "").replace(rxLines, "").replace(/\n{3,}/g, "\n\n");
    if (s !== before) {
      fs.writeFileSync(file, s, "utf8");
      console.log("cleaned:", path.relative(ROOT, file));
      changed++;
    }
  }
}
console.log(changed ? `Done, ${changed} files cleaned` : "No conflict markers found");
