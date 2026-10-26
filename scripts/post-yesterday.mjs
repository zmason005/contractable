// Posts yesterday's CONTRACTABLE word of the day to the Facebook Page.
//
// Usage:
//   node scripts/post-yesterday.mjs           -> dry run: prints the post, sends nothing
//   node scripts/post-yesterday.mjs --check   -> asks Facebook if the token works (no post)
//   node scripts/post-yesterday.mjs --post    -> really posts
//   add --day 204 to any mode to test a specific game day (204 = Oct 15, 2026)
//
// Needs env vars for --check and --post: FB_PAGE_ACCESS_TOKEN, FB_PAGE_ID

import { readFileSync } from "node:fs";

const START_DATE_MS = 1774396800000; // Day 0 = 2026-03-25 (same as main.js)
const DAY_MS = 86400000;
const GRAPH = "https://graph.facebook.com/v26.0";

const allWords = JSON.parse(
  readFileSync(new URL("../daily-word4.json", import.meta.url), "utf8")
);

/* ── Word-picking logic: copied unchanged from main.js ───────────────────── */

function mulberry32(seed) {
  seed = seed >>> 0;
  return function () {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let z = seed;
    z = Math.imul(z ^ (z >>> 15), z | 1) >>> 0;
    z = (z ^ (z + Math.imul(z ^ (z >>> 7), z | 61))) >>> 0;
    return ((z ^ (z >>> 14)) >>> 0) / 0x100000000;
  };
}

function deterministicShuffle(arr, seed) {
  const rng = mulberry32(seed);
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function applyFirstCharConstraint(arr, prevLastChar = null) {
  const a = arr.slice();
  if (prevLastChar !== null && a[0].print[0] === prevLastChar) {
    for (let j = 1; j < a.length; j++) {
      if (a[j].print[0] !== prevLastChar) {
        [a[0], a[j]] = [a[j], a[0]];
        break;
      }
    }
  }
  for (let i = 1; i < a.length; i++) {
    if (a[i].print[0] === a[i - 1].print[0]) {
      for (let j = i + 1; j < a.length; j++) {
        if (a[j].print[0] !== a[i - 1].print[0]) {
          [a[i], a[j]] = [a[j], a[i]];
          break;
        }
      }
    }
  }
  return a;
}

function buildCycle(cycleIndex, prevLastChar = null) {
  const seed = (START_DATE_MS + cycleIndex) >>> 0;
  const shuffled = deterministicShuffle(allWords, seed);
  return applyFirstCharConstraint(shuffled, prevLastChar);
}

function getWordForDayIndex(dayIndex) {
  const listSize = allWords.length || 1;
  const cycleIndex = Math.floor(dayIndex / listSize);
  const position = dayIndex % listSize;
  let prevLastChar = null;
  if (cycleIndex > 0) {
    const prevCycle = buildCycle(cycleIndex - 1, null);
    prevLastChar = prevCycle[prevCycle.length - 1].print[0];
  }
  const cycle = buildCycle(cycleIndex, prevLastChar);
  return cycle[position];
}

/* ── Post building ───────────────────────────────────────────────────────── */

function buildPost(dayIndex) {
  const word = getWordForDayIndex(dayIndex);
  const date = new Date(START_DATE_MS + dayIndex * DAY_MS).toLocaleDateString(
    "en-US",
    { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }
  );

  // The leading \u2800 (blank braille cell) matches your sample post.
  return [
    `The CONTRACTABLE word of the day for ${date} was (\u2800${word.brlunicode}) '${word.print}'.`,
    ``,
    `Feel free to comment and tell us how many guesses it took you to get the word.`,
    ``,
    `Have suggestions for our word library? Unlike Wordle and similar word games, there does not exist a comprehensive word library for 5 character contracted braille words. While print word banks consist of words that are exactly 5 letters, braille words are not always 5 letters. In fact, contracted words can contain as many as 10 letters (e.g., everything).`,
    ``,
    `Thank you for your support and for playing the game.`,
    ``,
    `You can play CONTRACTABLE at https://contractable.braillefirst.com.`,
  ].join("\n");
}

/* ── Facebook calls ──────────────────────────────────────────────────────── */

function requireEnv() {
  const token = process.env.FB_PAGE_ACCESS_TOKEN;
  const pageId = process.env.FB_PAGE_ID;
  if (!token || !pageId) {
    console.error("Missing FB_PAGE_ACCESS_TOKEN or FB_PAGE_ID in the environment.");
    process.exit(1);
  }
  return { token, pageId };
}

async function checkToken() {
  const { token, pageId } = requireEnv();
  const res = await fetch(
    `${GRAPH}/${pageId}?fields=name,id&access_token=${encodeURIComponent(token)}`
  );
  const body = await res.json();
  if (!res.ok) {
    console.error("Token check FAILED:", JSON.stringify(body.error ?? body));
    process.exit(1);
  }
  console.log(`Token OK. Page: "${body.name}" (id ${body.id}). Nothing was posted.`);
}

async function publish(message) {
  const { token, pageId } = requireEnv();
  const res = await fetch(`${GRAPH}/${pageId}/feed`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ message, access_token: token }),
  });
  const body = await res.json();
  if (!res.ok) {
    console.error("Post FAILED:", JSON.stringify(body.error ?? body));
    process.exit(1);
  }
  console.log("Posted. Facebook post id:", body.id);
}

/* ── Main ────────────────────────────────────────────────────────────────── */

const args = process.argv.slice(2);
const dayFlag = args.indexOf("--day");
const todayIndex = Math.floor((Date.now() - START_DATE_MS) / DAY_MS);
const dayIndex = dayFlag >= 0 ? Number(args[dayFlag + 1]) : todayIndex - 1; // yesterday

if (args.includes("--check")) {
  await checkToken();
} else {
  const message = buildPost(dayIndex);
  console.log(message);
  console.log("\n----");
  if (args.includes("--post")) {
    await publish(message);
  } else {
    console.log(`Dry run for game day ${dayIndex}. Nothing was sent. Add --post to publish.`);
  }
}
