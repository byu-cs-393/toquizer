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
export const STALE_MS = 3500;      // no heartbeat for this long = dropped off
