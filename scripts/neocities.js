"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const SITE = "manicmike";
const PREFIX = "omm/";
const BASE = "https://neocities.org/api/";
const DIRECTORY = path.resolve(__dirname, "../dist/web");
const manifestPath = path.join(DIRECTORY, "build-manifest.json");

function digest(data, algorithm = "sha256") {
  return crypto.createHash(algorithm).update(data).digest("hex");
}

function prepare() {
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (manifest.schema !== 1 || !manifest.files || Array.isArray(manifest.files)) {
    throw new Error("Invalid web manifest");
  }
  const names = Object.keys(manifest.files).sort();
  for (const required of ["index.html", "grid.js", "ai.js", "config.js", "generation.js", "movement.js", "progression.js", "state.js", "storage.js", "presentation.js", "game.js", "style.css", "touch-controls.js"]) {
    if (!names.includes(required)) throw new Error("Missing required file: " + required);
  }
  const files = names.map(name => {
    if (!/^(index\.html|grid\.js|ai\.js|config\.js|generation\.js|movement\.js|progression\.js|state\.js|storage\.js|presentation\.js|game\.js|style\.css|touch-controls\.js|assets\/[A-Za-z0-9 _.-]+\.(png|jpg|jpeg|svg|webp|ico))$/i.test(name)
        || name.includes("..")) throw new Error("Refusing unexpected deployment path: " + name);
    const bytes = fs.readFileSync(path.join(DIRECTORY, name));
    if (digest(bytes) !== manifest.files[name]) throw new Error("File digest mismatch: " + name);
    return { name: PREFIX + name, bytes };
  });
  files.push({ name: PREFIX + "build-manifest.json", bytes: manifestBytes });
  return files;
}

async function request(endpoint, key, body) {
  const response = await fetch(BASE + endpoint, {
    method: body ? "POST" : "GET",
    headers: { Authorization: "Bearer " + key },
    body,
    signal: AbortSignal.timeout(60000),
    redirect: "error"
  });
  let payload;
  try { payload = await response.json(); } catch { throw new Error("Non-JSON response from Neocities API"); }
  if (!response.ok || payload.result !== "success") {
    throw new Error("Neocities " + endpoint + " failed (HTTP " + response.status + ")");
  }
  return payload;
}

async function compare(files, key) {
  const body = new URLSearchParams(files.map(f => [f.name, digest(f.bytes, "sha1")]));
  const response = await request("upload_hash", key, body);
  if (!response.files || typeof response.files !== "object") throw new Error("Missing remote hash results");
  return response.files;
}

async function run() {
  const files = prepare();
  console.log("Deployment target: https://" + SITE + ".neocities.org/" + PREFIX);
  console.log("Verified " + files.length + " files; no deletes; no paths outside /" + PREFIX);
  if (!process.argv.includes("--upload")) {
    console.log("Dry run only. No network requests made.");
    return;
  }
  const key = process.env.NEOCITIES_API_KEY;
  if (!key || !key.trim()) throw new Error("NEOCITIES_API_KEY is missing. Set it locally; never paste it into chat or commit it.");
  const info = await request("info", key);
  if (info.info?.sitename !== SITE) throw new Error("API key belongs to a different Neocities site; no files uploaded");
  const hashes = await compare(files, key);
  const changed = files.filter(file => hashes[file.name] !== true);
  if (changed.length) {
    const form = new FormData();
    for (const file of changed) form.append(file.name, new Blob([file.bytes]), path.basename(file.name));
    await request("upload", key, form);
    const confirmed = await compare(files, key);
    if (files.some(file => confirmed[file.name] !== true)) throw new Error("Remote hash verification failed; inspect before retrying");
  }
  console.log("REMOTE HASH VERIFICATION PASS: " + files.length + " files.");
  console.log("Test URL: https://" + SITE + ".neocities.org/" + PREFIX);
}

run().catch(error => {
  console.error("Deployment stopped:", error.message);
  process.exitCode = 1;
});
