#!/usr/bin/env node
// Splits data/quiz.json into two halves:
//   public/quiz.json  - what every client may see (prompts, options, code)
//   .tmp/key.json     - answers + explanations, seeded into RTDB behind a reveal rule
// Nothing in public/ ever contains an answer.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const quiz = JSON.parse(readFileSync(resolve(root, "data/quiz.json"), "utf8"));

const SECRET = ["answer", "explain", "explainCode"];

const pub = { ...quiz, questions: [] };
const key = {};

for (const q of quiz.questions) {
  const open = {};
  const closed = {};
  for (const [k, v] of Object.entries(q)) {
    (SECRET.includes(k) ? closed : open)[k] = v;
  }
  pub.questions.push(open);
  key[q.id] = closed;
}

mkdirSync(resolve(root, ".tmp"), { recursive: true });
writeFileSync(resolve(root, "public/quiz.json"), JSON.stringify(pub, null, 2));
writeFileSync(resolve(root, ".tmp/key.json"), JSON.stringify(key, null, 2));

const leak = JSON.stringify(pub).match(/"(answer|explain|explainCode)"/);
if (leak) {
  console.error(`FAIL: ${leak[1]} leaked into public/quiz.json`);
  process.exit(1);
}
console.log(`public/quiz.json  ${pub.questions.length} questions, no answers`);
console.log(`.tmp/key.json     ${Object.keys(key).length} answer entries`);
