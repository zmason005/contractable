"use strict";

const MAX_GUESSES = 6;
const START_DATE_MS = 1774396800000; // Day 0 = 2026-03-25

let WORD_OF_THE_DAY = null; // Stored as a complete object: { id, print, brlunicode }
let allWords = [];          // Array of objects from daily-word2.json
let asciiToDots = {};       // Maps both print letters and Unicode Braille to binary dot strings
let dotsToAscii = {};       // Maps binary dot strings to literal Unicode Braille characters
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
  const listSize = allWords.length || 1; // Fallback protection against an empty word bank
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

function todayDayIndex() {
  const nowUTC = Date.now();
  return Math.floor((nowUTC - START_DATE_MS) / 86400000);
}

/* ── Loaders ──────────────────────────────────────────────────────────────── */

async function loadDailyWords() {
  try {
    const response = await fetch("daily-word2.json");
    if (!response.ok) throw new Error("Could not find daily-word2.json");
    // Preserve the raw array of objects for internal multi-property matching
    allWords = await response.json();
  } catch (e) {
    mobileLog("Daily Words Error: " + e.message);
  }
}

async function loadMapping() {
  try {
    const response = await fetch("brlunicode-mapping.json");
    if (!response.ok) throw new Error("Could not find brlunicode-mapping.json");
    const data = await response.json();
    
    asciiToDots = {};
    dotsToAscii = {};
    
    data.forEach(item => {
      // Normalize your 8-bit mask string down to the lower 6 dots for the layout matrix
      const sixDotMask = item.bitmask.slice(-6);
      
      // Bind both string presentations to the matching binary mask
      if (item.printAscii) {
        asciiToDots[item.printAscii.toLowerCase()] = sixDotMask;
      }
      if (item.unicodeChar) {
        asciiToDots[item.unicodeChar] = sixDotMask;
      }
      
      // Enforce raw Braille Unicode characters for game board rendering rows
      dotsToAscii[sixDotMask] = item.unicodeChar || "⠀";
    });
  } catch (e) {
    mobileLog("Mapping Error: " + e.message);
  }
}

/* ── UI & Game Logic ─────────────────────────────────────────────────────── */

function setStatus(msg) {
  const status = document.getElementById("status");
  status.textContent = msg;
  setTimeout(() => { status.focus(); }, 0);
}

function updateGuessLabel() {
  const label = document.getElementById("guess-label");
  label.textContent = (currentGuess === MAX_GUESSES - 1) ? "f9al guess" : "guess";
}

function mapStringToDots(str) {
  const dots = [];
  for (const ch of str) {
    const lowerCh = ch.toLowerCase();
    if (asciiToDots[lowerCh]) {
      dots.push(asciiToDots[lowerCh]);
    }
  }
  return dots;
}

function dotsArrayToAsciiString(arr) {
  return arr.map(d => dotsToAscii[d] ?? "⠀").join("");
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
  if (gameOver || !WORD_OF_THE_DAY) return;

  const input = document.getElementById("guess-input");
  const rawGuess = input.value.trim();
  const lowerGuess = rawGuess.toLowerCase();

  const targetPrint = WORD_OF_THE_DAY.print.toLowerCase();
  const targetUnicode = WORD_OF_THE_DAY.brlunicode;

  // Verify input against both columns (handles literal Unicode entries and iOS auto-translated print strings)
  const isMatch = (lowerGuess === targetPrint || rawGuess === targetUnicode);

  // If the user matches via print text, evaluate the dot layouts using the Unicode twin row
  const referenceGuessString = isMatch ? targetUnicode : rawGuess;
  const guessDots = mapStringToDots(referenceGuessString);

  if (guessDots.length !== 5) {
    setStatus("Invalid: Must be 5 Braille chars.");
    return;
  }

  const targetDots = mapStringToDots(targetUnicode);

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

  if (isMatch) {
    setStatus(",,y ,,w96");
    gameOver = true;
  } else if (currentGuess >= MAX_GUESSES) {
    setStatus(`,sorry1 ! ~w 0 ${targetUnicode}`);
    gameOver = true;
  }
}

async function init() {
  await Promise.all([loadMapping(), loadDailyWords()]);

  if (allWords.length > 0) {
    WORD_OF_THE_DAY = getWordForDayIndex(todayDayIndex());
    // Clear debug container if tracking components load successfully
    const debugLog = document.getElementById("debug-log");
    if (debugLog) debugLog.textContent = ""; 
  } else {
    mobileLog("Critical: No words loaded. Check JSON files.");
  }

  const input = document.getElementById("guess-input");
  const button = document.getElementById("submit-btn");

  button.addEventListener("click", submitGuess);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitGuess();
    }
  });

  updateGuessLabel();
  input.focus();
}

init().catch(e => mobileLog("Init Error: " + e.message));
