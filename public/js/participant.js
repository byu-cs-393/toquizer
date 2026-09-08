import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getDatabase, ref, onValue, set, onDisconnect, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

import { firebaseConfig, HEARTBEAT_MS } from "./config.js";
import { nameFor, newUuid } from "./names.js";
import { QUIZ, questionAt, LETTERS, isCorrect } from "./quiz.js";
import { codeBlock } from "./hl.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

const $ = (id) => document.getElementById(id);
const main = $("main"), dot = $("dot"), whoEl = $("who"), hereEl = $("here"), savedEl = $("saved");

/* ---------------- identity ----------------
   The UUID is the identity and it lives in localStorage, so a refresh, a
   dropped connection, or a locked phone all come back as the same person with
   the same answers. The friendly name is derived from it, never stored. */
const KEY = "toquizer.uuid";
let uuid = localStorage.getItem(KEY);
if (!uuid) { uuid = newUuid(); localStorage.setItem(KEY, uuid); }
const myName = nameFor(uuid);
whoEl.textContent = myName;

let uid = null;
let state = null;         // { qIndex, phase }
const myAnswers = {};     // qid -> value, kept locally so re-render is instant
const revealedKey = {};   // qid -> { answer, explain, explainCode }
const keySubs = new Set();

signInAnonymously(auth).catch((e) => fail("Could not sign in: " + e.message));

onAuthStateChanged(auth, (user) => {
  if (!user) return;
  uid = user.uid;
  startHeartbeat();
  onValue(ref(db, "state"), (s) => { state = s.val(); render(); });
  onValue(ref(db, "stats/joined"), (s) => {
    hereEl.innerHTML = "<b>" + (s.val() || 0) + "</b> here";
  });
});

/* ---------------- presence ----------------
   A 1 Hz heartbeat is what "joined" means. onDisconnect is the backstop: a
   cleanly closed tab disappears immediately instead of waiting to go stale. */
function startHeartbeat() {
  const me = ref(db, "presence/" + uid);
  const beat = () => set(me, { name: myName, t: serverTimestamp() }).catch(() => {});
  onDisconnect(me).remove();
  beat();
  setInterval(beat, HEARTBEAT_MS);

  onValue(ref(db, ".info/connected"), (s) => {
    const ok = s.val() === true;
    dot.classList.toggle("off", !ok);
    dot.title = ok ? "connected" : "reconnecting...";
    if (ok) { onDisconnect(me).remove(); beat(); }
  });

  // Coming back from a locked screen or another app: beat immediately rather
  // than waiting out whatever interval the browser throttled us to.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") beat();
  });
}

/* ---------------- answers ---------------- */
let saveTimer = null;
let pending = null;      // a debounced write that has not gone out yet

function saveAnswer(qid, v, opts) {
  const debounce = (opts && opts.debounce) || 0;
  myAnswers[qid] = v;
  clearTimeout(saveTimer);
  const write = () => {
    pending = null;
    set(ref(db, "answers/" + qid + "/" + uid), { v: v, t: serverTimestamp() })
      .then(() => flash("Saved"))
      .catch((e) => flash("Not saved: " + e.message, true));
  };
  if (debounce) { pending = write; saveTimer = setTimeout(write, debounce); }
  else write();
}

/* Typing is debounced, so a half-second of it is still in the air when someone
   locks their phone mid-sentence - and a backgrounded tab's timers are throttled
   or frozen, which would strand it. Flush on the way out instead. */
function flushPending() {
  if (!pending) return;
  clearTimeout(saveTimer);
  pending();
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushPending();
});
addEventListener("pagehide", flushPending);

let flashTimer = null;
function flash(msg, bad) {
  savedEl.textContent = msg;
  savedEl.classList.toggle("on", !bad);
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    savedEl.innerHTML = "&nbsp;";
    savedEl.classList.remove("on");
  }, 1600);
}

/* Subscribe to a question's answer key. The rules only let this through once the
   presenter reveals, so before that the read simply fails and we stay quiet. */
function watchKey(qid) {
  if (keySubs.has(qid)) return;
  keySubs.add(qid);
  onValue(ref(db, "key/" + qid),
    (s) => { if (s.exists()) { revealedKey[qid] = s.val(); render(); } },
    () => { keySubs.delete(qid); });
}

/* ---------------- render ---------------- */
function fail(msg) {
  main.innerHTML = '<div class="wait"><div class="big"></div></div>';
  main.querySelector(".big").textContent = msg;
}

function waiting(big, subHtml) {
  main.innerHTML = '<div class="wait"><div class="big"></div>' +
    (subHtml ? "<div>" + subHtml + "</div>" : "") + "</div>";
  main.querySelector(".big").textContent = big;
}

function render() {
  if (!state || state.phase === "lobby" || state.qIndex == null || state.qIndex < 0) {
    return waiting("You're in.", "Hang tight — <b>" + myName + "</b> is on the board.");
  }
  if (state.phase === "done") return waiting("That's the quiz.", "Thanks for playing.");

  const q = questionAt(state.qIndex);
  if (!q) return waiting("Waiting...");
  watchKey(q.id);

  const revealed = state.phase === "reveal" && revealedKey[q.id];
  main.innerHTML = "";

  const head = document.createElement("div");
  head.innerHTML =
    '<div class="qnum">Question ' + (state.qIndex + 1) + " of " + QUIZ.questions.length + "</div>" +
    '<div class="prompt"></div>' + (q.help ? '<div class="help"></div>' : "");
  head.querySelector(".prompt").textContent = q.prompt;
  if (q.help) head.querySelector(".help").textContent = q.help;
  main.append(head);

  if (state.phase === "code") {
    const look = document.createElement("div");
    look.className = "wait";
    look.innerHTML = '<div class="big">Look up 👀</div>' +
      "<div>Read the code on the screen. Answers open in a moment.</div>";
    main.append(look);
    if (q.code) main.append(codeAccordion(q.code, true));
    return;
  }

  main.append(widgetFor(q, revealed));
  if (q.code) main.append(codeAccordion(q.code, false));
  if (revealed) main.append(verdictFor(q, revealedKey[q.id]));
}

function codeAccordion(code, open) {
  const d = document.createElement("details");
  d.className = "codebox";
  d.open = open;
  const s = document.createElement("summary");
  s.textContent = open ? "The code" : "Show the code";
  d.append(s, codeBlock(code));
  return d;
}

function widgetFor(q, revealed) {
  const key = revealedKey[q.id];
  if (q.type === "mc") return mcWidget(q, key, revealed, false);
  if (q.type === "multi") return mcWidget(q, key, revealed, true);
  if (q.type === "order") return orderWidget(q, key, revealed);
  return textWidget(q);
}

function mcWidget(q, key, revealed, multi) {
  const wrap = document.createElement("div");
  wrap.className = "opts";
  const cur = myAnswers[q.id];
  const chosen = new Set(multi ? (cur || []) : (cur ? [cur] : []));

  q.options.forEach((o, i) => {
    const b = document.createElement("button");
    b.className = "opt";
    b.type = "button";
    b.setAttribute("aria-pressed", String(chosen.has(o.id)));
    b.innerHTML = '<span class="letter">' + LETTERS[i] + '</span><span class="txt"></span>';
    b.querySelector(".txt").textContent = o.text;

    if (revealed && key && key.answer) {
      if (key.answer.includes(o.id)) {
        b.classList.add(chosen.has(o.id) ? "is-correct" : "is-missed");
      }
    }
    b.onclick = () => {
      if (multi) {
        if (chosen.has(o.id)) chosen.delete(o.id); else chosen.add(o.id);
        saveAnswer(q.id, [...chosen]);
      } else {
        saveAnswer(q.id, o.id);
      }
      render();
    };
    wrap.append(b);
  });
  return wrap;
}

function orderWidget(q, key, revealed) {
  const wrap = document.createElement("div");
  wrap.className = "order";
  // Start from the order the deck shows, then let them shuffle it with arrows.
  // Arrows beat drag on a phone: big targets, and no fight with page scroll.
  const ids = myAnswers[q.id] ? [...myAnswers[q.id]] : q.options.map((o) => o.id);
  const byId = Object.fromEntries(q.options.map((o) => [o.id, o]));

  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    const t = ids[i]; ids[i] = ids[j]; ids[j] = t;
    saveAnswer(q.id, [...ids]);
    render();
    requestAnimationFrame(() => {
      const rows = document.querySelectorAll(".order .row");
      if (!rows[j]) return;
      rows[j].classList.add("just-moved");
      const btn = rows[j].querySelector(d < 0 ? ".up" : ".down");
      if (btn && !btn.disabled) btn.focus();
    });
  };

  ids.forEach((id, i) => {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML =
      '<span class="rank">' + (i + 1) + '</span><span class="label"></span>' +
      '<span class="moves">' +
      '<button class="up" type="button" aria-label="Move up">▲</button>' +
      '<button class="down" type="button" aria-label="Move down">▼</button>' +
      "</span>";
    row.querySelector(".label").textContent = byId[id] ? byId[id].text : id;
    const up = row.querySelector(".up"), down = row.querySelector(".down");
    up.disabled = i === 0;
    down.disabled = i === ids.length - 1;
    up.onclick = () => move(i, -1);
    down.onclick = () => move(i, 1);
    if (revealed && key && key.answer) {
      row.classList.add(key.answer[i] === id ? "is-right" : "is-wrong");
    }
    wrap.append(row);
  });
  return wrap;
}

function textWidget(q) {
  const ta = document.createElement("textarea");
  ta.className = "answer";
  ta.placeholder = "Type your answer...";
  ta.maxLength = 2000;
  ta.value = myAnswers[q.id] || "";
  ta.oninput = () => saveAnswer(q.id, ta.value, { debounce: 700 });
  return ta;
}

function verdictFor(q, key) {
  const v = document.createElement("div");
  const got = isCorrect(q, myAnswers[q.id], key);
  v.className = "verdict" + (got === true ? " good" : got === false ? " bad" : "");
  const title = got === true ? "Correct"
    : got === false ? "Not quite"
    : myAnswers[q.id] ? "Thanks for answering"
    : "You didn't answer this one";
  v.innerHTML = "<h3></h3><p></p>";
  v.querySelector("h3").textContent = title;
  v.querySelector("p").textContent = key.explain || "";
  if (key.explainCode) v.append(codeBlock(key.explainCode));
  return v;
}
