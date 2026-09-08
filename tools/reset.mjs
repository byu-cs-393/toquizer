#!/usr/bin/env node
// Wipe the room: every answer, everyone's presence, and the reveal flags that
// unlock the answer key. Run before class so last run's data is not on screen.
// The presenter's `r` key does the same thing from the podium.
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT = "toquizer";
const win = process.platform === "win32";
const fb = win ? "firebase.cmd" : "firebase";

// Node refuses to spawn a .cmd without a shell, so Windows needs shell: true.
const run = (args) =>
  execFileSync(fb, [...args, "--project", PROJECT], {
    cwd: root, shell: win, stdio: ["ignore", "pipe", "pipe"],
  });

for (const path of ["/answers", "/presence", "/state/revealed", "/stats"]) {
  try { run(["database:remove", path, "--force"]); console.log("cleared " + path); }
  catch (e) { console.error("could not clear " + path + ": " + (e.stderr || e).toString().trim().split("\n").pop()); }
}

mkdirSync(resolve(root, ".tmp"), { recursive: true });
const lobby = resolve(root, ".tmp/state.json");
writeFileSync(lobby, JSON.stringify({ qIndex: -1, phase: "lobby", t: 0 }));
run(["database:set", "/state", ".tmp/state.json", "--force"]);
console.log("back to the lobby");
