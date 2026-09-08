// The public half of the quiz: prompts, options, code. Never the answers.
export const QUIZ = await fetch("quiz.json", { cache: "no-cache" }).then((r) => r.json());

// Phases a question walks through. A question with code gets an extra screen
// first where the code owns the whole projector; when voting opens the same
// code element shrinks into the corner so it stays available while they answer.
export function phasesFor(q) {
  return q.code ? ["code", "vote", "tally", "reveal"] : ["vote", "tally", "reveal"];
}

export function questionAt(i) {
  return QUIZ.questions[i] ?? null;
}

export const LETTERS = "ABCDEFGH";

// Did this response earn the point? `key` is the revealed answer entry.
export function isCorrect(q, v, key) {
  if (!key || v == null) return null;
  const a = key.answer;
  if (!a) return null;
  if (q.type === "mc") return a.includes(v);
  if (q.type === "multi") {
    const got = [...(v || [])].sort().join(",");
    return got === [...a].sort().join(",");
  }
  if (q.type === "order") return (v || []).join(",") === a.join(",");
  return null;
}
