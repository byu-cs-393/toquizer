export const firebaseConfig = {
  apiKey: "AIzaSyCG817qdWpNHBFfw4Sq8bKuh7r6aql3LsU",
  authDomain: "toquizer.firebaseapp.com",
  databaseURL: "https://toquizer-default-rtdb.firebaseio.com",
  projectId: "toquizer",
  storageBucket: "toquizer.firebasestorage.app",
  messagingSenderId: "1096051612898",
  appId: "1:1096051612898:web:a9ea16a06e7a2996a892bb",
};

// Only this account may drive the presentation or read raw responses.
// Must match the email baked into database.rules.json.
export const PRESENTER_EMAIL = "michaeltreynolds@gmail.com";

export const HEARTBEAT_MS = 1000;  // participant -> /presence/<uid>/t

// How stale a heartbeat may get before we stop counting someone as joined.
//
// Deliberately generous. Browsers throttle timers in a backgrounded tab - a
// student who locks their phone or checks a message can go 60s between beats
// while still connected and still about to answer, and a 3-4s window drops the
// whole room the moment screens dim. Real departures do not wait for this
// window anyway: onDisconnect().remove() runs server-side the instant the
// socket closes, so this only sweeps up rows left by a hard kill.
export const STALE_MS = 30000;
