import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, setPersistence, browserLocalPersistence }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getDatabase, ref, onValue, set, update, remove }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

import { firebaseConfig, PRESENTER_EMAIL, STALE_MS } from "./config.js";
import { QUIZ, phasesFor, questionAt, LETTERS, isCorrect } from "./quiz.js";
import { codeBlock } from "./hl.js";
import qrcode from "./vendor/qrcode.mjs";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

const $ = (id) => document.getElementById(id);

/* ---------------- the timeline ----------------
   Every screen in the deck, flattened, so "next" is just an index. A question
   with code gets a screen of its own before voting opens. */
const TIMELINE = [{ q: -1, phase: "lobby" }];
QUIZ.questions.forEach((q, i) => phasesFor(q).forEach((p) => TIMELINE.push({ q: i, phase: p })));
TIMELINE.push({ q: QUIZ.questions.length, phase: "done" });

const posOf = (s) =>
  Math.max(0, TIMELINE.findIndex((t) => t.q === s.qIndex && t.phase === s.phase));

/* ---------------- live data ---------------- */
let state = { qIndex: -1, phase: "lobby" };
let serverOffset = 0;
let presence = {};        // uid -> { name, t }
const seenNames = {};     // uid -> name, kept after they drop off
let answers = {};         // uid -> { v, t } for the CURRENT question
let answersUnsub = null;
let watchedQid = null;
let lastRenderKey = "";

/* ---------------- sign in ----------------
   Persistence has to be settled before the first sign-in call or the request can
   be dropped on the floor - which looks, at a podium, like a dead button. */
const persistenceReady = setPersistence(auth, browserLocalPersistence).catch(() => {});

// The form ships disabled. Enabling it here is the signal that this module is
// live - otherwise a fast Enter key would do a native GET submit and put the
// password in the address bar.
{
  const btn = $("signinForm").querySelector("button[type=submit]");
  btn.disabled = false;
  btn.textContent = "Sign in";
}

$("signinForm").onsubmit = async (e) => {
  e.preventDefault();
  const btn = $("signinForm").querySelector("button[type=submit]");
  $("signinErr").textContent = "";
  btn.disabled = true;
  btn.textContent = "Signing in…";
  try {
    await persistenceReady;
    await signInWithEmailAndPassword(auth, $("email").value.trim(), $("password").value);
  } catch (err) {
    $("signinErr").textContent = err.code === "auth/invalid-credential"
      ? "That email and password did not match."
      : (err.code || "") + " " + err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "Sign in";
  }
};

onAuthStateChanged(auth, (user) => {
  const ok = user && user.email === PRESENTER_EMAIL;
  $("gate").classList.toggle("hidden", !!ok);
  $("show").classList.toggle("hidden", !ok);
  if (!ok) {
    if (user) $("signinErr").textContent = "That account cannot present.";
    return;
  }
  $("quizTitle").textContent = QUIZ.title;
  boot();
});

let booted = false;
function boot() {
  if (booted) return;          // onAuthStateChanged can fire more than once
  booted = true;
  onValue(ref(db, ".info/serverTimeOffset"), (s) => { serverOffset = s.val() || 0; });

  onValue(ref(db, "state"), (s) => {
    const v = s.val();
    // First run in an empty database: start at the lobby.
    if (!v) { writeState({ qIndex: -1, phase: "lobby" }); return; }
    state = v;
    watchAnswersFor(state.qIndex);
    render();
  });

  onValue(ref(db, "presence"), (s) => {
    presence = s.val() || {};
    for (const [uid, p] of Object.entries(presence)) if (p && p.name) seenNames[uid] = p.name;
    render();
  });

  setInterval(pushStats, 1000);   // recompute joined/answered against the server clock
  wireKeys();
}

/* A participant counts as joined while their heartbeat is fresh. Compare against
   the server clock, not this machine's - a podium PC with a skewed clock would
   otherwise show an empty room or a room that never empties. */
function joinedUids() {
  const now = Date.now() + serverOffset;
  return Object.entries(presence)
    .filter(([, p]) => p && typeof p.t === "number" && now - p.t < STALE_MS)
    .map(([uid]) => uid);
}

function pushStats() {
  const joined = joinedUids().length;
  const answered = Object.keys(answers).length;
  $("nJoined").textContent = joined;
  $("nAnswered").textContent = answered;
  set(ref(db, "stats"), { joined, answered, qid: watchedQid || null }).catch(() => {});
  if (state.phase === "lobby" || state.phase === "vote") render();
}

function watchAnswersFor(qIndex) {
  const q = questionAt(qIndex);
  const qid = q ? q.id : null;
  if (qid === watchedQid) return;
  if (answersUnsub) answersUnsub();
  watchedQid = qid;
  answers = {};
  answersUnsub = qid
    ? onValue(ref(db, "answers/" + qid), (s) => { answers = s.val() || {}; render(); })
    : null;
}

/* ---------------- navigation ----------------
   Always write /state field by field. A set() on /state would take the whole
   node with it, including /state/revealed - which is what unlocks the answer
   key - and silently re-lock every question already revealed. */
function writeState(s) {
  return update(ref(db, "state"), { qIndex: s.qIndex, phase: s.phase, t: Date.now() });
}

async function goto(pos) {
  const t = TIMELINE[Math.max(0, Math.min(TIMELINE.length - 1, pos))];
  const q = questionAt(t.q);
  const patch = { qIndex: t.q, phase: t.phase, t: Date.now() };
  // Revealing is a database fact, not a UI one: it is what unlocks the answer
  // key for the participants' clients. Same write as the move, so the screen and
  // the permission can never disagree.
  if (t.phase === "reveal" && q) patch["revealed/" + q.id] = true;
  await update(ref(db, "state"), patch);
}

const next = () => goto(posOf(state) + 1);
const prev = () => goto(posOf(state) - 1);

async function restart() {
  if (!confirm("Restart the quiz? This clears every answer and re-hides the answer key.")) return;
  await Promise.all([remove(ref(db, "answers")), remove(ref(db, "state/revealed"))]);
  await writeState({ qIndex: -1, phase: "lobby" });
}

function wireKeys() {
  $("nextBtn").onclick = next;
  $("prevBtn").onclick = prev;
  addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea")) return;
    if (e.key === " " || e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); next(); }
    else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); prev(); }
    else if (e.key === "f") document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    else if (e.key === "r") restart();
  });
  // Keep the control bar out of the way until the mouse comes near it.
  let t;
  addEventListener("mousemove", () => {
    $("ctl").classList.remove("dim");
    clearTimeout(t);
    t = setTimeout(() => $("ctl").classList.add("dim"), 2500);
  });
  setTimeout(() => $("ctl").classList.add("dim"), 2500);
  addEventListener("resize", () => placeCode());   // drop the Event arg
}

/* ---------------- the code panel ---------------- */
let codeShownFor = null;

function setCode(q, docked) {
  const wrap = $("codewrap"), inner = $("codeinner");
  if (!q || !q.code) {
    wrap.classList.add("gone");
    codeShownFor = null;
    document.body.classList.remove("docked");
    return;
  }
  if (codeShownFor !== q.id) {
    inner.innerHTML = "";
    inner.append(codeBlock(q.code));
    codeShownFor = q.id;
  }
  wrap.classList.remove("gone");
  document.body.classList.toggle("docked", docked);
  placeCode(docked);
}

function placeCode(docked) {
  const wrap = $("codewrap"), inner = $("codeinner");
  if (wrap.classList.contains("gone")) return;
  if (docked === undefined) docked = document.body.classList.contains("docked");

  // Measure at natural size with the transform removed, then scale into the box.
  const prev = wrap.style.transform;
  wrap.style.transition = "none";
  wrap.style.transform = "none";
  const w = inner.offsetWidth, h = inner.offsetHeight;
  wrap.style.transform = prev;
  void wrap.offsetWidth;              // flush, so the transition does not replay
  wrap.style.transition = "";

  const vw = innerWidth, vh = innerHeight;
  let box;
  if (docked) {
    box = { x: 0.02 * vw, y: vh - 0.46 * vh, w: 0.30 * vw, h: 0.42 * vh };
  } else {
    // Start below the question, whatever height it wrapped to.
    const heading = document.querySelector("#stage .prompt-big");
    const top = heading
      ? heading.getBoundingClientRect().bottom + 0.025 * vh
      : 4.2 * 16 + 0.04 * vh;
    box = { x: 0.07 * vw, y: top, w: 0.86 * vw, h: vh - top - 0.07 * vh };
  }

  const s = Math.min(box.w / w, box.h / h, 2.2);
  const x = box.x + (box.w - w * s) / 2;
  const y = box.y + (box.h - h * s) / 2;
  wrap.style.transform = "translate(" + x + "px," + y + "px) scale(" + s + ")";
}

/* ---------------- render ---------------- */
function render() {
  const stage = $("stage");
  const q = questionAt(state.qIndex);
  const phase = state.phase;

  $("qcount").textContent = q ? "Question " + (state.qIndex + 1) + " of " + QUIZ.questions.length : "";
  $("phaseLabel").textContent = phase;
  document.body.classList.toggle("phase-code", phase === "code");

  // Only rebuild the DOM when the screen actually changes; live counts update
  // in place so the bars do not restart their animation every second.
  const key = state.qIndex + "|" + phase;
  if (key !== lastRenderKey) {
    lastRenderKey = key;
    stage.innerHTML = "";
    build(stage, q, phase);
  } else {
    refresh(stage, q, phase);
  }

  // After the stage exists: placeCode measures the prompt to know where the
  // full-screen code may start, so the card never lands under the heading.
  setCode(q, phase !== "code");
}

function build(stage, q, phase) {
  if (phase === "lobby") return buildLobby(stage);
  if (phase === "done") return buildDone(stage);

  const h = document.createElement("h1");
  h.className = "prompt-big";
  if (q.tag) {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = q.tag;
    h.append(tag);
  }
  h.append(document.createTextNode(q.prompt));
  stage.append(h);

  if (phase === "code") return;          // the code panel owns the screen

  if (q.help && phase === "vote") {
    const help = document.createElement("div");
    help.className = "help-big";
    help.textContent = q.help;
    stage.append(help);
  }

  const body = document.createElement("div");
  body.id = "body";
  stage.append(body);
  refresh(stage, q, phase);
}

function refresh(stage, q, phase) {
  const body = $("body");
  if (!body || !q || phase === "code") return;

  if (phase === "vote") return renderVote(body, q);
  renderResults(body, q, phase === "reveal");
}

/* --- voting: the options, and nothing that hints at the split --- */
function renderVote(body, q) {
  if (q.type === "text") {
    if (body.dataset.mode !== "text-vote") {
      body.dataset.mode = "text-vote";
      body.innerHTML = '<div class="headline">Typing on your phones — <b id="tcount">0</b> so far</div>';
    }
    const c = $("tcount");
    if (c) c.textContent = Object.values(answers).filter((a) => a && String(a.v).trim()).length;
    return;
  }
  if (body.dataset.mode === "vote") return;   // static once drawn
  body.dataset.mode = "vote";
  body.innerHTML = "";
  if (q.type === "order") {
    const list = document.createElement("div");
    list.className = "ordres";
    q.options.forEach((o) => {
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = '<span class="rank" style="background:var(--panel-2);color:var(--ink-dim)">?</span><span class="label"></span>';
      row.querySelector(".label").textContent = o.text;
      list.append(row);
    });
    body.append(list);
    return;
  }
  const grid = document.createElement("div");
  grid.className = "opts-big" + (q.options.length <= 3 ? " one" : "");
  q.options.forEach((o, i) => {
    const d = document.createElement("div");
    d.className = "opt-big";
    d.innerHTML = '<span class="letter">' + LETTERS[i] + '</span><span class="txt"></span>';
    d.querySelector(".txt").textContent = o.text;
    grid.append(d);
  });
  body.append(grid);
}

/* --- results --- */
function renderResults(body, q, revealed) {
  if (revealed) loadKey(q.id);

  if (q.type === "text") return renderWall(body, q, revealed);
  if (q.type === "order") return renderOrder(body, q, revealed);
  return renderBars(body, q, revealed);
}

// The presenter can always read the key; fetch it lazily on reveal. One
// subscription per question - render() runs often and would otherwise stack up.
const keyLoaded = new Set();
function loadKey(qid) {
  window.__key = window.__key || {};
  if (keyLoaded.has(qid)) return;
  keyLoaded.add(qid);
  onValue(ref(db, "key/" + qid), (s) => {
    window.__key[qid] = s.val();
    lastRenderKey = "";     // force a rebuild now that we know the answer
    render();
  }, () => { keyLoaded.delete(qid); });
}

function tally(q) {
  const counts = Object.fromEntries(q.options.map((o) => [o.id, 0]));
  let responders = 0;
  for (const a of Object.values(answers)) {
    if (!a || a.v == null) continue;
    responders++;
    const picks = Array.isArray(a.v) ? a.v : [a.v];
    for (const p of picks) if (p in counts) counts[p]++;
  }
  return { counts, responders };
}

function renderBars(body, q, revealed) {
  const key = window.__key && window.__key[q.id];
  const { counts, responders } = tally(q);
  const denom = Math.max(1, responders);

  if (body.dataset.mode !== "bars") {
    body.dataset.mode = "bars";
    body.innerHTML = '<div class="headline" id="hl"></div><div class="bars" id="bars"></div><div id="exp"></div>';
    const bars = $("bars");
    q.options.forEach((o, i) => {
      const d = document.createElement("div");
      d.className = "bar";
      d.dataset.id = o.id;
      d.innerHTML = '<span class="fill"></span><span class="letter">' + LETTERS[i] +
        '</span><span class="txt"></span><span class="n"><span class="cnt"></span><span class="pct"></span></span>';
      d.querySelector(".txt").textContent = o.text;
      bars.append(d);
    });
  }

  for (const d of $("bars").children) {
    const n = counts[d.dataset.id] || 0;
    const pct = Math.round((100 * n) / denom);
    d.querySelector(".fill").style.width = pct + "%";
    d.querySelector(".cnt").textContent = n;
    d.querySelector(".pct").textContent = pct + "%";
    const right = revealed && key && key.answer && key.answer.includes(d.dataset.id);
    d.classList.toggle("correct", !!right);
    d.classList.toggle("dim", !!(revealed && key && key.answer && !right));
  }

  const correctCount = revealed && key
    ? Object.values(answers).filter((a) => isCorrect(q, a && a.v, key) === true).length
    : null;
  $("hl").innerHTML = revealed
    ? "<b>" + correctCount + "</b> of " + responders + " got it"
    : responders + " answered";

  putExplain($("exp"), revealed ? key : null);
}

function renderOrder(body, q, revealed) {
  const key = window.__key && window.__key[q.id];
  const byId = Object.fromEntries(q.options.map((o) => [o.id, o]));
  const lists = Object.values(answers).map((a) => a && a.v).filter(Array.isArray);

  if (body.dataset.mode !== "order") {
    body.dataset.mode = "order";
    body.innerHTML = '<div class="headline" id="hl"></div><div class="ordres" id="ord"></div><div id="exp"></div>';
  }

  // Before the reveal, show where the class landed (mean rank). After it, show
  // the real order with how many people put each item in that slot.
  let rows;
  if (revealed && key && key.answer) {
    rows = key.answer.map((id, slot) => {
      const hits = lists.filter((l) => l[slot] === id).length;
      return { id, slot, pct: lists.length ? Math.round((100 * hits) / lists.length) : 0 };
    });
  } else {
    const mean = {};
    q.options.forEach((o) => {
      const ranks = lists.map((l) => l.indexOf(o.id)).filter((i) => i >= 0);
      mean[o.id] = ranks.length ? ranks.reduce((a, b) => a + b, 0) / ranks.length : 99;
    });
    rows = q.options.slice().sort((a, b) => mean[a.id] - mean[b.id])
      .map((o, slot) => ({ id: o.id, slot, pct: null }));
  }

  const ord = $("ord");
  ord.innerHTML = "";
  rows.forEach((r) => {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = '<span class="fill"></span><span class="rank"></span><span class="label"></span><span class="pct"></span>';
    row.querySelector(".rank").textContent = r.slot + 1;
    row.querySelector(".label").textContent = byId[r.id] ? byId[r.id].text : r.id;
    if (r.pct === null) {
      row.querySelector(".rank").style.cssText = "background:var(--panel-2);color:var(--ink-dim)";
      row.querySelector(".pct").textContent = "";
    } else {
      row.querySelector(".pct").textContent = r.pct + "% put it here";
      row.querySelector(".fill").style.width = r.pct + "%";
    }
    ord.append(row);
  });

  const exact = revealed && key
    ? lists.filter((l) => l.join(",") === key.answer.join(",")).length : null;
  $("hl").innerHTML = revealed
    ? "<b>" + exact + "</b> of " + lists.length + " got the whole order right"
    : lists.length + " answered &middot; the class consensus so far";

  putExplain($("exp"), revealed ? key : null);
}

function renderWall(body, q, revealed) {
  const key = window.__key && window.__key[q.id];
  if (body.dataset.mode !== "wall") {
    body.dataset.mode = "wall";
    body.innerHTML = '<div class="headline" id="hl"></div><div class="wall" id="wall"></div><div id="exp"></div>';
  }
  const names = displayNames();
  const rows = Object.entries(answers)
    .filter(([, a]) => a && String(a.v).trim())
    .sort((a, b) => (a[1].t || 0) - (b[1].t || 0));

  const wall = $("wall");
  wall.innerHTML = "";
  rows.forEach(([uid, a]) => {
    const c = document.createElement("div");
    c.className = "card";
    c.innerHTML = '<div class="from"></div><div class="body"></div>';
    c.querySelector(".from").textContent = names[uid] || "Someone";
    c.querySelector(".body").textContent = a.v;
    wall.append(c);
  });
  $("hl").innerHTML = rows.length + " answers";
  putExplain($("exp"), revealed ? key : null);
}

function putExplain(el, key) {
  if (!el) return;
  el.innerHTML = "";
  if (!key || !key.explain) return;
  const d = document.createElement("div");
  d.className = "explain";
  d.textContent = key.explain;
  el.append(d);
  if (key.explainCode) {
    const light = document.createElement("div");
    light.className = "codecard";
    light.style.cssText = "margin-top:1rem;display:inline-block";
    light.append(codeBlock(key.explainCode));
    el.append(light);
  }
}

/* Two people can land on the same friendly name (about a 7% chance in a class of
   40). Disambiguate at display time, where we can see the whole room. */
function displayNames() {
  const out = {};
  const bucket = {};
  for (const [uid, name] of Object.entries(seenNames)) (bucket[name] ||= []).push(uid);
  for (const [name, uids] of Object.entries(bucket)) {
    uids.sort();
    uids.forEach((uid, i) => { out[uid] = uids.length > 1 ? name + " " + (i + 1) : name; });
  }
  return out;
}

/* ---------------- lobby ---------------- */
function buildLobby(stage) {
  const url = location.origin + "/";
  const short = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  stage.innerHTML =
    '<div class="lobby">' +
      '<div id="qr"></div>' +
      '<div class="join">' +
        '<div class="lead">Join at</div>' +
        '<div class="url"></div>' +
        '<div class="roster" id="roster"></div>' +
      "</div>" +
    "</div>";
  stage.querySelector(".url").textContent = short;

  const q = qrcode(0, "M");
  q.addData(url);
  q.make();
  $("qr").innerHTML = q.createSvgTag({ cellSize: 6, margin: 0 });

  refreshRoster();
}

const rosterShown = new Set();
function refreshRoster() {
  const el = $("roster");
  if (!el) return;
  const names = displayNames();
  const live = joinedUids();
  const want = new Set(live.map((uid) => names[uid] || "Someone"));

  for (const child of [...el.children]) {
    if (!want.has(child.textContent)) { rosterShown.delete(child.textContent); child.remove(); }
  }
  for (const n of want) {
    if (rosterShown.has(n)) continue;
    rosterShown.add(n);
    const s = document.createElement("span");
    s.className = "new";
    s.textContent = n;
    el.append(s);
  }
}

function buildDone(stage) {
  stage.innerHTML = '<div class="lobby"><div class="join">' +
    '<div class="url">Thanks!</div>' +
    '<div class="lead">Press <kbd>r</kbd> to restart the quiz.</div>' +
    "</div></div>";
}

// The lobby roster is the one screen that wants a live tick.
setInterval(() => { if (state.phase === "lobby") refreshRoster(); }, 1000);
