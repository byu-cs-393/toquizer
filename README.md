# toquizer — the CS 393 Big O quiz

A live, in-class quiz built around one thing Mentimeter will not do: **show the code
full screen for as long as you like, then shrink it into the corner and open voting,
with the code still on screen while they answer.**

- **Class / presenter screen:** <https://toquizer.web.app/present.html>
- **Students join at:** <https://toquizer.web.app> (the lobby projects this as a QR code)

Students need no account and no app. They open the URL, get a UUID in `localStorage`
and a friendly name derived from it (`Ministering Cougar`, `Fasting Hymnbook`), and
start heartbeating once a second. That heartbeat is what "joined" means — see the
note on `STALE_MS` below for why the window around it is deliberately wide.

## Running it in class

1. Open the presenter screen, sign in, press <kbd>f</kbd> for fullscreen.
2. The lobby shows the QR code and names appearing as students arrive. Wait for
   **joined** to level off.
3. <kbd>space</kbd> advances one screen. <kbd>←</kbd> goes back. Every question walks
   the same path:

   | phase | what is on the projector |
   |---|---|
   | `code` | *(code questions only)* the snippet, full screen, nothing else |
   | `vote` | code shrinks into the bottom-left; question + options fill the screen. **No counts** — only *joined* and *answered* in the corner |
   | `tally` | the split, with no answer marked. Discuss it before you commit |
   | `reveal` | correct option(s) highlighted, explanation shown. This is also the moment the answer key unlocks for the students' phones |

4. <kbd>r</kbd> restarts: clears every answer and re-hides the key.

The two counters in the top right are the point of the whole thing: **joined** is how
many phones are heartbeating right now, **answered** is how many have submitted on the
current question. Watch the gap close, then advance.

Students can change their answer at any time, including after the reveal — so the
tally on screen stays live while you talk.

## The quiz

Nine questions, from the Mentimeter deck and the Big O slide deck:

| # | id | type | |
|---|---|---|---|
| 1 | `order` | ordering | rank nine complexities biggest → smallest |
| 2 | `labels` | multi-select | which name/complexity pairings are right |
| 3 | `nmk` | free response | an algorithm that is O(N+M+K) — answers appear on screen as a wall of cards |
| 4 | `arraylist` | multiple choice | amortized cost of inserting into a doubling ArrayList |
| 5–9 | `code1`–`code5` | multiple choice | five code snippets: "what is the efficiency?" |

Question 4 accepts **two** options: `2 * Final Size` and `2 * 2 ^ (Log (Final Size))`
are the same number written two ways. Both are marked correct and the explanation
says so — it is worth a minute of class time.

Question 9 carries a follow-up snippet (the `set(list2)` fix) that appears on the
reveal screen.

## Before you push

`origin` is **public** (`byu-cs-393/toquizer`) and `data/quiz.json` contains the answer
key. Pushing as-is publishes it. Either make the repo private, or move `data/quiz.json`
out of git (`.gitignore` it and keep the key in the database, which is already where the
app reads it from). The deployed app is unaffected either way — no answer has ever
shipped to `public/`.

## Editing the quiz

`data/quiz.json` is the source of truth. `npm run deploy` splits it in two:

- everything except `answer`, `explain`, and `explainCode` → `public/quiz.json`, which
  anyone can read;
- those three fields → `/key/<id>` in the database, readable **only** once you reveal
  that question.

The build fails loudly if an answer ever leaks into the public file. Nothing in
`public/` contains an answer, so devtools on a student's laptop shows them nothing.

```bash
npm run deploy    # rebuild, push rules + hosting, reseed the answer key
npm run reset     # wipe answers/presence and go back to the lobby
```

## How it is wired

Firebase Realtime Database + Firebase Hosting on the `toquizer` GCP project. No
server code. RTDB rather than Firestore specifically because of the heartbeat: RTDB
bills on bandwidth, so 40 students at 1 Hz for an hour is noise, where Firestore
would bill every beat as a document write. It also gives `onDisconnect`, so a closed
laptop drops off the roster immediately instead of waiting to go stale.

```
/state      { qIndex, phase, revealed: { <qid>: true } }   presenter writes, everyone reads
/stats      { joined, answered }                            presenter writes, everyone reads
/presence   /<uid> { name, t }                              you write your own only
/answers    /<qid>/<uid> { v, t }                           you write and read your own only
/key        /<qid> { answer, explain, explainCode }         readable only once revealed
```

Two roles, enforced in `database.rules.json`, not in the UI:

- **Participants** sign in anonymously. They can write their own presence and their
  own answer, read neither, and cannot touch `/state`.
- **The presenter** signs in with email + password. The rules hardcode that address;
  everything privileged keys off `auth.token.email`.

Changing the presenter's email means changing it in **both** `database.rules.json` and
`public/js/config.js`, then `npm run deploy`.

### Things worth knowing before you change anything

- **Never `set()` on `/state`.** It would take `/state/revealed` with it and silently
  re-lock every question already revealed. `goto()` writes fields with `update()`.
- Presence staleness is measured against the **server** clock via
  `.info/serverTimeOffset`. A podium PC with a skewed clock would otherwise show an
  empty room, or one that never empties.
- **Departures come from `onDisconnect`, not from the heartbeat.** Browsers throttle
  timers in a backgrounded tab, so a student who locks their phone can go a minute
  between beats while still connected — a tight staleness window empties the roster
  every time the room's screens dim. `STALE_MS` is 30s and only sweeps up rows left
  behind by a hard kill; a closed tab is removed server-side the instant its socket
  drops.
- The friendly name is `hash(uuid)` through a murmur3 finalizer. The finalizer is not
  decoration: raw FNV-1a has weak low bits and `% 100` reads exactly those, which put
  duplicate names in a 40-person class at 26% instead of the 7.4% the birthday bound
  predicts. Same-name collisions that do happen are disambiguated on the presenter's
  screen, where the whole room is visible.
- The presenter's sign-in button ships `disabled` and `present.js` enables it. Without
  that, a fast <kbd>Enter</kbd> before the module loads does a native GET submit and
  puts the password in the address bar.

## Layout

```
data/quiz.json          the quiz, answers included — the only file you edit
tools/build.mjs         splits it into the public half and the answer key
tools/reset.mjs         wipes a run
database.rules.json     who may read and write what
public/
  index.html            student
  present.html          projector + presenter controls
  js/quiz.js            phases, scoring
  js/names.js           the BYU/LDS word lists and the UUID -> name hash
  js/hl.js              a small syntax highlighter (no CDN — a lecture hall
                        should not wait on one)
  js/vendor/qrcode.mjs  vendored for the same reason
```
