“use strict”;

/*
Security Note:
This file does not evaluate user input as code.
All input is validated against an explicit mapping table.
*/

const MAX_GUESSES = 6;

/* ── Daily Word Constants ─────────────────────────────────────────────────── */

// Day 0 = 2026-03-25 UTC midnight (ms since Unix epoch)
const START_DATE_MS = 1774396800000;

/* ── State ────────────────────────────────────────────────────────────────── */

let WORD_OF_THE_DAY = “”;   // set by init() after both files are loaded
let allWords        = [];   // ordered list of ascii values (indices 0-1771)

let asciiToDots = {};
let dotsToAscii = {};

let currentGuess = 0;
let gameOver     = false;

// per-position persistent hint fields
let correctDots = Array(5).fill(“000000”);
let wrongDots   = Array(5).fill(“000000”);

/* ── Daily Word Selection ─────────────────────────────────────────────────── */

/**

- Mulberry32 — a fast, seedable 32-bit PRNG that is identical in JS and Python.
- Returns a closure that yields the next float in [0, 1) on each call.
  */
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

/**

- Fisher-Yates shuffle using the mulberry32 PRNG seeded with `seed`.
- Always produces the same permutation for the same seed.
  */
  function deterministicShuffle(arr, seed) {
  const rng = mulberry32(seed);
  const a   = arr.slice();
  for (let i = a.length - 1; i > 0; i–) {
  const j = Math.floor(rng() * (i + 1));
  [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
  }

/**

- Enforce the rule that no two consecutive words share the same first character.
- `prevLastChar` is the last character of the previous cycle (or null for cycle 0).
  */
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

/**

- Build one full cycle’s word list (1772 words, shuffled + constrained).
  */
  function buildCycle(cycleIndex, prevLastChar = null) {
  const seed = (START_DATE_MS + cycleIndex) >>> 0;
  const shuffled = deterministicShuffle(allWords, seed);
  return applyFirstCharConstraint(shuffled, prevLastChar);
  }

/**

- Return the word for a given day index (0 = 2026-03-25).
- Cycles repeat with a fresh shuffle every 1772 days.
  */
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

/**

- Compute how many whole UTC days have elapsed since START_DATE_MS.
  */
  function todayDayIndex() {
  const nowUTC = Date.now();
  return Math.floor((nowUTC - START_DATE_MS) / 86400000);
  }

/* ── Loaders ──────────────────────────────────────────────────────────────── */

async function loadDailyWords() {
const response = await fetch(“daily-words.json”);
const data     = await response.json();

const total = Object.keys(data).length;
allWords = [];
for (let i = 1; i <= total; i++) {
allWords.push(data[String(i)].ascii);
}
}

async function loadMapping() {
const response = await fetch(“braille-ascii-map.json”);
const data     = await response.json();

asciiToDots = data;
for (const [ascii, dots] of Object.entries(data)) {
dotsToAscii[dots] = ascii;
}
}

/* ── Status Helpers ───────────────────────────────────────────────────────── */

function setStatus(msg) {
const status = document.getElementById(“status”);
status.textContent = msg;
setTimeout(() => { status.focus(); }, 0);
}

/* ── Guess Label ──────────────────────────────────────────────────────────── */

function updateGuessLabel() {
const label = document.getElementById(“guess-label”);
label.textContent = (currentGuess === MAX_GUESSES - 1) ? “f9al guess” : “guess”;
}

/* ── Utilities ────────────────────────────────────────────────────────────── */

function mapStringToDots(str) {
const dots = [];
for (const ch of str) {
if (Object.prototype.hasOwnProperty.call(asciiToDots, ch)) {
dots.push(asciiToDots[ch]);
}
}
return dots;
}

function dotsArrayToAsciiString(arr) {
return arr.map(d => dotsToAscii[d] ?? “ “).join(””);
}

function validateGuess(str) {
return mapStringToDots(str).length === 5;
}

function guessLabel(index) {
return index < 6 ? `#${String.fromCharCode(97 + index)}` : “”;
}

/* ── Row Formatting ───────────────────────────────────────────────────────── */

function formatRow({ guessIndex, correct, guess, wrong }) {
const label = guessLabel(guessIndex);
return `${label} ${correct} ${guess} ${wrong}`;
}

/* ── Rendering ────────────────────────────────────────────────────────────── */

function renderRow(rowText) {
const board = document.getElementById(“game-board”);
const row   = document.createElement(“div”);
row.className   = “row”;
row.tabIndex    = -1;
row.textContent = rowText;
board.appendChild(row);
row.focus();
}

/* ── Game Logic ───────────────────────────────────────────────────────────── */

function endGame() {
gameOver = true;
document.getElementById(“guess-input”).disabled = true;
document.getElementById(“submit-btn”).disabled  = true;
}

function submitGuess() {
if (gameOver) return;

const input    = document.getElementById(“guess-input”);
const rawGuess = input.value;

if (!validateGuess(rawGuess)) return;

const guessDots  = mapStringToDots(rawGuess);
const targetDots = mapStringToDots(WORD_OF_THE_DAY);

for (let i = 0; i < 5; i++) {
const g = parseInt(guessDots[i],  2);
const t = parseInt(targetDots[i], 2);

```
const overlap = g &  t;
const wrong   = g & ~t;

correctDots[i] = (parseInt(correctDots[i], 2) | overlap)
  .toString(2).padStart(6, "0");

wrongDots[i] = (parseInt(wrongDots[i], 2) | wrong)
  .toString(2).padStart(6, "0");
```

}

renderRow(formatRow({
guessIndex: currentGuess,
correct:    dotsArrayToAsciiString(correctDots),
guess:      rawGuess,
wrong:      dotsArrayToAsciiString(wrongDots),
}));

currentGuess++;
input.value = “”;

updateGuessLabel();

if (rawGuess === WORD_OF_THE_DAY) {
setStatus(”,,y ,,w96”);
endGame();
return;
}

if (currentGuess >= MAX_GUESSES) {
setStatus(`,sorry1 ! ~w 0 ${WORD_OF_THE_DAY}`);
endGame();
}
}

/* ── Init ─────────────────────────────────────────────────────────────────── */

async function init() {
await Promise.all([loadMapping(), loadDailyWords()]);

WORD_OF_THE_DAY = getWordForDayIndex(todayDayIndex());

const input  = document.getElementById(“guess-input”);
const button = document.getElementById(“submit-btn”);

button.addEventListener(“click”, submitGuess);
input.addEventListener(“keydown”, (e) => {
if (e.key === “Enter”) {
e.preventDefault();
submitGuess();
}
});

updateGuessLabel();
input.focus();
}

init();