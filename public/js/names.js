// A participant is identified by a UUID. The friendly name is derived from that
// UUID deterministically, so a refresh (or a reconnect) keeps the same name.
// 100 x 100 = 10,000 pairs.

const VERBS = [
  "Ministering","Ponderizing","Testifying","Fellowshipping","Sustaining","Magnifying",
  "Consecrating","Pondering","Covenanting","Serving","Kneeling","Feasting","Hearkening",
  "Girding","Seeking","Enduring","Praying","Fasting","Journaling","Tithing","Repenting",
  "Forgiving","Uplifting","Edifying","Exhorting","Succoring","Nourishing","Gathering",
  "Harvesting","Preparing","Pressing","Cleaving","Hastening","Bearing","Sharing",
  "Welcoming","Rejoicing","Praising","Singing","Studying","Memorizing","Discerning",
  "Watching","Standing","Striving","Yearning","Laboring","Building","Tending","Lifting",
  "Comforting","Blessing","Dedicating","Sealing","Anointing","Visiting","Greeting",
  "Pioneering","Trekking","Returning","Reporting","Volunteering","Mentoring","Tutoring",
  "Cheering","Devoting","Reflecting","Recommitting","Renewing","Rallying","Beaming",
  "Kindling","Illuminating","Anchoring","Steadying","Persevering","Flourishing",
  "Abounding","Thriving","Rising","Reaching","Believing","Hoping","Trusting","Waiting",
  "Listening","Learning","Teaching","Guiding","Leading","Encouraging","Sanctifying",
  "Delighting","Marveling","Wondering","Treasuring","Cherishing","Honoring","Esteeming",
  "Beholding",
];

const NOUNS = [
  "Cougar","Cosmo","Creamery","Mint Brownie","Y Mountain","Testimony","Devotional",
  "Roommate","Freshman","Bookstore","Ring Road","Helaman","Heritage","Wilkinson",
  "Marriott","Talmage","Maeser","Clyde","JFSB","Library","Tanner","Cannon Center",
  "Rock Canyon","Provo","Square Dance","Ward","FHE","Institute","Scripture","Casserole",
  "Jell-O","Funeral Potatoes","Chapel","Hymnbook","Handcart","Pioneer","Seagull",
  "Beehive","Deseret","Liahona","Iron Rod","Olive Tree","Sunbeam","Primary","Nursery",
  "Quorum","Sacrament","Fireside","Seminary","Nametag","Companion","Syllabus","Midterm",
  "Whiteboard","Lanyard","Backpack","Longboard","Bike Lane","Scooter","Snow Cone",
  "Slushie","Waffle","Pancake","Chocolate Milk","Blue Cup","Ramen","Cafeteria",
  "Study Room","Cubicle","Elevator","Stairwell","Quad","Fountain","Bell Tower",
  "Blue Line","Sweatshirt","Poster","Highlighter","Flashcard","Notebook","Calculator",
  "Compiler","Semicolon","Whitespace","Recursion","Pointer","Hash Map","Linked List",
  "Binary Tree","Stack Trace","Merge Sort","Unit Test","Pull Request","Rubber Duck",
  "Big O","Constant","Logarithm","Factorial","Exponent","Whiteboard Marker",
];

// FNV-1a, then a murmur3 finalizer. Same input, same name, every time, in every
// browser. The finalizer matters: raw FNV-1a has weak low bits, and `% 100` reads
// exactly those - without the avalanche step a 40-person class collides ~26% of
// the time instead of the ~7.5% the birthday bound predicts.
function hash(str, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

export function nameFor(uuid) {
  const verb = VERBS[hash(uuid, 0x811c9dc5) % VERBS.length];
  const noun = NOUNS[hash(uuid, 0x9e3779b9) % NOUNS.length];
  return `${verb} ${noun}`;
}

export function newUuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export const POOL = VERBS.length * NOUNS.length;
