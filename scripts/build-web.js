"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "app");
const target = path.join(root, "dist", "web");
const files = ["index.html", "style.css", "grid.js", "ai.js", "game.js", "touch-controls.js"];
const assets = path.join(source, "assets");
function list(dir, prefix = "") {
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name, "en"))
    .flatMap(entry => {
      const relative = path.join(prefix, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Symlink is not a release asset: " + relative);
      if (entry.isDirectory()) return list(path.join(dir, entry.name), relative);
      if (!entry.isFile()) throw new Error("Unsupported asset: " + relative);
      return [relative];
    });
}
files.push(...list(assets, "assets"));
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const manifest = {
  schema: 1,
  files: Object.fromEntries(files.map(name => {
    if (!fs.lstatSync(path.join(source, name)).isFile()) throw new Error("Not a regular source file: " + name);
    return [name.split(path.sep).join("/"), hash(fs.readFileSync(path.join(source, name)))];
  }))
};
const manifestText = JSON.stringify(manifest, null, 2) + "\n";
if (!process.argv.includes("--check")) {
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  for (const name of files) {
    const dest = path.join(target, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(source, name), dest);
  }
  fs.writeFileSync(path.join(target, "build-manifest.json"), manifestText);
}
const expected = [...Object.keys(manifest.files), "build-manifest.json"].sort();
const actual = list(target).map(name => name.split(path.sep).join("/")).sort();
if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error("Unexpected or missing web files");
for (const [name, digest] of Object.entries(manifest.files)) {
  if (hash(fs.readFileSync(path.join(target, name))) !== digest) throw new Error("Web parity mismatch: " + name);
}
if (fs.readFileSync(path.join(target, "build-manifest.json"), "utf8") !== manifestText) throw new Error("Manifest mismatch");
console.log("Web distribution parity verified: " + expected.length + " files.");
