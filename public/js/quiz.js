// The public half of the quiz: prompts, options, code. Never the answers.
//
// Retried, because this is a top-level await: if it throws, the whole module
// graph fails and the page sits there looking merely slow. Classroom wifi drops
// a request now and then and that should not end the lesson.
async function loadQuiz() {
  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch("quiz.json", { cache: "no-cache" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } catch (e) {
      last = e;
      await new Promise((res) => setTimeout(res, 400 * (attempt + 1)));
    }
  }
  throw last;
}

export const QUIZ = await loadQuiz();

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
