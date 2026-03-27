"use strict";

// scripts/get-daily-word.js
// Computes today's Contractable word of the day and prints it to stdout.
// Used by the GitHub Actions workflow to populate the daily email.

const fs   = require("fs");
const path = require("path");

/* ── Constants ────────────────────────────────────────────────────────────── */

// Must match Main.js exactly
const START_DATE_MS = 1774396800000; // 2026-03-25 UTC midnight

/* ── Load data files ──────────────────────────────────────────────────────── */

// Resolve paths relative to the repo root (workflow sets CWD there)
const dailyWordsPath = path.join(process.cwd(), "Daily-words.json");
const brailleMapPath = path.join(process.cwd(), "Braille-ascii-map.json");

const dailyWordsRaw = JSON.parse(fs.readFileSync(dailyWordsPath, "utf8"));
const brailleMap    = JSON.parse(fs.readFileSync(brailleMapPath, "utf8"));

// Build ordered word list (1-indexed keys → ascii values)
const total    = Object.keys(dailyWordsRaw).length;
const allWords = [];
for (let i = 1; i <= total; i++) {
  allWords.push(dailyWordsRaw[String(i)].ascii);
}

// Build reverse map: dots → ascii char
const dotsToAscii = {};
for (const [ascii, dots] of Object.entries(brailleMap)) {
  dotsToAscii[dots] = ascii;
}

/* ── PRNG & shuffle (identical to Main.js) ────────────────────────────────── */

function mulberry32(seed) {
  seed = seed >>> 0;
  return function () {
    seed = (seed + 0x6D2B79F5) >>> 0;
    let z = seed;
    z = Math.imul(z ^ (z >>> 15), z | 1) >>> 0;
    z = (z ^ (z + Math.imul(z ^ (z >>> 7), z | 61))) >>> 0;
    return ((z ^ (z >>> 14)) >>> 0) / 0x100000000;
  };
}

function deterministicShuffle(arr, seed) {
  const rng = mulberry32(seed);
  const a   = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function applyFirstCharConstraint(arr, prevLastChar = null) {
  const a = arr.slice();

  if (prevLastChar !== null && a[0][0] === prevLastChar) {
    for (let j = 1; j < a.length; j++) {
      if (a[j][0] !== prevLastChar) {
        [a[0], a[j]] = [a[j], a[0]];
        break;
      }
    }
  }

  for (let i = 1; i < a.length; i++) {
    if (a[i][0] === a[i - 1][0]) {
      for (let j = i + 1; j < a.length; j++) {
        if (a[j][0] !== a[i - 1][0]) {
          [a[i], a[j]] = [a[j], a[i]];
          break;
        }
      }
    }
  }

  return a;
}

function buildCycle(cycleIndex, prevLastChar = null) {
  const seed     = (START_DATE_MS + cycleIndex) >>> 0;
  const shuffled = deterministicShuffle(allWords, seed);
  return applyFirstCharConstraint(shuffled, prevLastChar);
}

function getWordForDayIndex(dayIndex) {
  const cycleIndex = Math.floor(dayIndex / 1772);
  const position   = dayIndex % 1772;

  let prevLastChar = null;
  if (cycleIndex > 0) {
    const prevCycle = buildCycle(cycleIndex - 1, null);
    prevLastChar = prevCycle[prevCycle.length - 1][0];
  }

  const cycle = buildCycle(cycleIndex, prevLastChar);
  return cycle[position];
}

function todayDayIndex() {
  return Math.floor((Date.now() - START_DATE_MS) / 86400000);
}

/* ── Lookup print word ────────────────────────────────────────────────────── */

function asciiToPrintWord(ascii) {
  // Search the daily words JSON for a matching ascii value
  for (let i = 1; i <= total; i++) {
    const entry = dailyWordsRaw[String(i)];
    if (entry.ascii === ascii) {
      return entry.print;
    }
  }
  return ascii; // fallback: return the ascii form if not found
}

/* ── Main ─────────────────────────────────────────────────────────────────── */

const dayIndex   = todayDayIndex();
const asciiWord  = getWordForDayIndex(dayIndex);
const printWord  = asciiToPrintWord(asciiWord);

// Emit as JSON so the workflow can parse both values cleanly
const output = JSON.stringify({ ascii: asciiWord, print: printWord, dayIndex });
process.stdout.write(output + "\n");