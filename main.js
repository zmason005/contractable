"use strict";

const MAX_GUESSES = 6;
const START_DATE_MS = 1774396800000; // Day 0 = 2026-03-25

let WORD_OF_THE_DAY = "";
let allWords = [];
let asciiToDots = {};
let dotsToAscii = {};
let currentGuess = 0;
let gameOver = false;

let correctDots = Array(5).fill("000000");
let wrongDots = Array(5).fill("000000");

// Helper to log errors directly to the screen on iPhone
function mobileLog(msg) {
  const log = document.getElementById("debug-log");
  if (log) log.textContent += msg + "\n";
  console.error(msg);
}

/* ── PRNG & Logic ────────────────────────────────────────────────────────── */

function mulberry32(seed) {
  seed = seed >>> 0;
  return function() {
    seed = (seed + 0x6D2B79F5) >>> 0;
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
  const seed = (START_DATE_MS + cycleIndex) >>> 0;
  const shuffled = deterministicShuffle(allWords, seed);
  return applyFirstCharConstraint(shuffled, prevLastChar);
}

function getWordForDayIndex(dayIndex) {
  const cycleIndex = Math.floor(dayIndex / 1772);
  const position = dayIndex % 1772;
  let prevLastChar = null;
  if (cycleIndex > 0) {
    const prevCycle = buildCycle(cycleIndex - 1, null);
    prevLastChar = prevCycle[prevCycle.length - 1][0];
  }
  const cycle = buildCycle(cycleIndex, prevLastChar);
  return cycle[position];
}

function todayDayIndex() {
  const nowUTC = Date.now();
  return Math.floor((nowUTC - START_DATE_MS) / 86400000);
}

/* ── Loaders ──────────────────────────────────────────────────────────────── */

async function loadDailyWords() {
  try {
    const response = await fetch("daily-words.json");
    if (!response.ok) throw new Error("Could not find daily-words.json");
    const data = await response.json();
    allWords = Object.values(data).map(item => item.ascii);
  } catch (e) {
    mobileLog("Daily Words Error: " + e.message);
  }
}

async function loadMapping() {
  try {
    const response = await fetch("braille-ascii-map.json");
    if (!response.ok) throw new Error("Could not find braille-ascii-map.json");
    asciiToDots = await response.json();
    for (const [ascii, dots] of Object.entries(asciiToDots)) {
      dotsToAscii[dots] = ascii;
    }
  } catch (e) {
    mobileLog("Mapping Error: " + e.message);
  }
}

/* ── UI & Game Logic ─────────────────────────────────────────────────────── */

function setStatus(msgText, msgBraille) {
  const status = document.getElementById("status");
  if (!status) return;

  // Enforce strict lower-case format for screen readers on dynamic alerts
  status.setAttribute("aria-label", msgText.toLowerCase());
  
  // Deliver the un-translated raw pin stream directly to Braille display devices
  status.setAttribute("aria-braillelabel", msgBraille);
  
  // Write the visual Unicode symbols directly into the DOM tree container
  status.textContent = msgBraille;
  
  setTimeout(() => { status.focus(); }, 0);
}

function updateGuessLabel() {
  const label = document.getElementById("guess-label");
  if (!label) return;

  if (currentGuess === MAX_GUESSES - 1) {
    label.setAttribute("aria-label", "final guess");
    label.setAttribute("aria-braillelabel", "⠋⠔⠁⠇⠀⠛⠥⠑⠎⠎");
    label.textContent = "⠋⠔⠁⠇⠀⠛⠥⠑⠎⠎";
  } else {
    label.setAttribute("aria-label", "guess");
    label.setAttribute("aria-braillelabel", "⠛⠥⠑⠎⠎");
    label.textContent = "⠛⠥⠑⠎⠎";
  }
}

function mapStringToDots(str) {
  const dots = [];
  for (const ch of str) {
    if (asciiToDots[ch]) {
      dots.push(asciiToDots[ch]);
    }
  }
  return dots;
}

function dotsArrayToAsciiString(arr) {
  return arr.map(d => dotsToAscii[d] ?? " ").join("");
}

function formatRow({ guessIndex, correct, guess, wrong }) {
  const label = guessIndex < 6 ? `#${String.fromCharCode(97 + guessIndex)}` : "";
  return `${label} ${correct} ${guess} ${wrong}`;
}

function renderRow(rowText) {
  const board = document.getElementById("game-board");
  const row = document.createElement("div");
  row.className = "row";
  row.tabIndex = -1;
  row.textContent = rowText;
  board.appendChild(row);
  row.focus();
}

function submitGuess() {
  if (gameOver) return;

  const input = document.getElementById("guess-input");
  if (!input) return;

  const rawGuess = input.value;
  const guessDots = mapStringToDots(rawGuess);

  // Length Validation Checkpoint with Decoupled Response Strategy
  if (guessDots.length !== 5) {
    setStatus("must be 5 braille characters", "⠠⠍⠌⠀⠆⠀⠼⠑⠀⠃⠗⠇⠀⠐⠡⠎");
    return;
  }

  const targetDots = mapStringToDots(WORD_OF_THE_DAY);

  for (let i = 0; i < 5; i++) {
    const g = parseInt(guessDots[i], 2);
    const t = parseInt(targetDots[i], 2);

    const overlap = g & t;
    const wrong = g & ~t;

    correctDots[i] = (parseInt(correctDots[i], 2) | overlap)
      .toString(2).padStart(6, "0");

    wrongDots[i] = (parseInt(wrongDots[i], 2) | wrong)
      .toString(2).padStart(6, "0");
  }

  renderRow(formatRow({
    guessIndex: currentGuess,
    correct: dotsArrayToAsciiString(correctDots),
    guess: rawGuess,
    wrong: dotsArrayToAsciiString(wrongDots),
  }));

  currentGuess++;
  input.value = "";
  updateGuessLabel();

  // End Game Win/Loss Routing
  if (rawGuess === WORD_OF_THE_DAY) {
    setStatus("you win!", "⠠⠠⠽⠀⠠⠠⠺⠔⠖");
    gameOver = true;
  } else if (currentGuess >= MAX_GUESSES) {
    setStatus("sorry, the word was " + WORD_OF_THE_DAY, "⠠⠎⠕⠗⠗⠽⠂⠀⠮⠀⠘⠺⠀⠴⠀" + WORD_OF_THE_DAY);
    gameOver = true;
  }
}

async function init() {
  await Promise.all([loadMapping(), loadDailyWords()]);

  if (allWords.length > 0) {
    WORD_OF_THE_DAY = getWordForDayIndex(todayDayIndex());
    // Clear debug container if files loaded clean
    const debugLog = document.getElementById("debug-log");
    if (debugLog) debugLog.textContent = ""; 
  } else {
    mobileLog("Critical: No words loaded. Check JSON files.");
  }

  const input = document.getElementById("guess-input");
  const button = document.getElementById("submit-btn");

  if (button) button.addEventListener("click", submitGuess);
  if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submitGuess();
      }
    });
    input.focus();
  }

  updateGuessLabel();
}

init().catch(e => mobileLog("Init Error: " + e.message));
