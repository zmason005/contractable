"use strict";

const MAX_GUESSES = 6;
const START_DATE_MS = 1774396800000; // Day 0 = 2026-03-25

let WORD_OF_THE_DAY = null; // Stored as a complete object: { id, print, brlunicode }
let allWords = [];          // Array of objects from daily-word2.json
let asciiToDots = {};       // Maps both Computer Braille ASCII and Unicode Braille to 8-bit binary strings
let dotsToAscii = {};       // Maps 8-bit binary strings to literal Unicode Braille characters
let currentGuess = 0;
let gameOver = false;

// Persistent metric tracking targets across rounds (Cumulative)
let correctDots = [];

// End game custom Braille Unicode messaging
const WIN_STATUS_MESSAGE = "⠄⡳⠭⠴⠴⠢⠔⠄⠄⡳⠭⠴⠴⠲⠋⠄⠄⡳⠭⠴⠴⠢⠢⠄⠄⡳⠭⠴⠴⠆⠴⠄⠄⡳⠭⠴⠴⠢⠶⠄⠄⡳⠭⠴⠴⠲⠔⠄⠄⡳⠭⠴⠴⠲⠑⠄⠄⡳⠭⠴⠴⠆⠂⠄⠄⡳⠭⠴⠴⠆⠴⠄⠄⡳⠭⠴⠴⠆⠴⠄⠄⡳⠭⠴⠴⠒⠙⠄⠄⡳⠭⠴⠴⠆⠴⠄⠄⡳⠭⠴⠴⠆⠴⠄⠠⠠⠽⠀⠠⠠⠺⠔⠖⠀⠀";
const LOSE_STATUS_MESSAGE = "⠀⠠⠎⠕⠗⠗⠽⠂⠀⠛⠁⠍⠑⠀⠕⠧⠻⠲⠀";

// Maps row numeric indices to strict Braille Unicode row prefixes
const ROW_NUMERIC_PREFIXES = ["⠼⠁", "⠼⠃", "⠼⠉", "⠼⠙", "⠼⠑", "⠼⠋"];

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
          [a[i], a[j]] = [a[j], a[0]];
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

function todayDayIndex() {
  const nowUTC = Date.now();
  return Math.floor((nowUTC - START_DATE_MS) / 86400000);
}

/* ── Loaders ──────────────────────────────────────────────────────────────── */

async function loadDailyWords() {
  try {
    const response = await fetch("daily-word2.json");
    if (!response.ok) throw new Error("Could not find daily-word2.json");
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
      const fullBitmask = item.bitmask;
      
      // Maps Computer Braille ASCII characters passed from iOS input stream
      if (item.printAscii) {
        asciiToDots[item.printAscii] = fullBitmask;
      }
      // Maps literal Unicode Braille characters passed from iOS input stream
      if (item.unicodeChar) {
        asciiToDots[item.unicodeChar] = fullBitmask;
      }
      
      dotsToAscii[fullBitmask] = item.unicodeChar || "\u2800";
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

function dotsArrayToAsciiString(arr) {
  return arr.map(d => dotsToAscii[d] ?? "\u2800").join("");
}

function formatRow({ guessIndex, correct, guess, wrong }) {
  const label = guessIndex < 6 ? ROW_NUMERIC_PREFIXES[guessIndex] : "";
  return `${label}\u2800${correct}\u2800${guess}\u2800${wrong}`;
}

function renderRow(rowText) {
  const board = document.getElementById("game-board");
  const row = document.createElement("div");
  row.className = "row";
  row.tabIndex = -1;
  
  row.setAttribute("aria-braillelabel", rowText);
  row.setAttribute("aria-label", `Row ${currentGuess + 1}`);

  const visualWrapper = document.createElement("span");
  visualWrapper.setAttribute("aria-hidden", "true");
  visualWrapper.textContent = rowText;
  
  row.appendChild(visualWrapper);
  board.appendChild(row);
  row.focus();
}

function submitGuess() {
  if (gameOver || !WORD_OF_THE_DAY) return;

  const input = document.getElementById("guess-input");
  const rawGuess = input.value.trim();
  if (!rawGuess) return;

  let matchedWord = null;
  let guessAsUnicode = "";

  // Regular expression to identify standard alphanumeric text (Contracted UEB output from iOS)
  const isStandardPrint = /^[A-Za-z0-9]+$/.test(rawGuess);

  if (isStandardPrint) {
    // PATH 1: Text processed by iOS translation tables into standard print words
    const lowerGuess = rawGuess.toLowerCase();
    matchedWord = allWords.find(word => word.print.toLowerCase() === lowerGuess);
    
    if (matchedWord) {
      guessAsUnicode = matchedWord.brlunicode;
    }
  } else {
    // PATH 2: Multi-table dot processing (Computer Braille ASCII, Braille ASCII, or Unicode Braille Patterns)
    const guessDots = [];
    for (const ch of rawGuess) {
      guessDots.push(asciiToDots[ch] || "00000000"); 
    }
    
    guessAsUnicode = dotsArrayToAsciiString(guessDots);
    matchedWord = allWords.find(word => word.brlunicode === guessAsUnicode);
  }

  // Dictionary validation gate: Reject arbitrary length-mismatched or non-existent strings
  if (!matchedWord) {
    setStatus("Not in word list.");
    return;
  }

  // Establish targets using today's true word lengths
  const targetUnicode = WORD_OF_THE_DAY.brlunicode;
  const targetDots = [];
  for (const ch of targetUnicode) {
    targetDots.push(asciiToDots[ch] || "00000000");
  }

  // Build current guess metrics array normalized to true bitmasks
  const guessDotsArray = [];
  for (const ch of guessAsUnicode) {
    guessDotsArray.push(asciiToDots[ch] || "00000000");
  }

  // Dynamic initialization of persistent correct trackers to cleanly fit targeted cell array bounds
  if (correctDots.length !== targetDots.length) {
    correctDots = Array(targetDots.length).fill(0);
  }

  const rowCorrectStrings = [];
  const rowWrongStrings = [];

  // Evaluate bits row-by-row up to the explicit structural size of the target word
  for (let i = 0; i < targetDots.length; i++) {
    const g = parseInt(guessDotsArray[i] || "00000000", 2);
    const t = parseInt(targetDots[i], 2);

    // Correct bits build permanently over previous rounds
    correctDots[i] |= (g & t);

    // Wrong bits are strictly isolated to this round's input discrepancies
    const currentWrongBits = (g & ~t);

    rowCorrectStrings.push(correctDots[i].toString(2).padStart(8, "0"));
    rowWrongStrings.push(currentWrongBits.toString(2).padStart(8, "0"));
  }

  renderRow(formatRow({
    guessIndex: currentGuess,
    correct: dotsArrayToAsciiString(rowCorrectStrings),
    guess: guessAsUnicode,
    wrong: dotsArrayToAsciiString(rowWrongStrings),
  }));

  currentGuess++;
  input.value = "";
  updateGuessLabel();

  // Validate match criteria using normalized print records from database
  const isMatch = (matchedWord.print.toLowerCase() === WORD_OF_THE_DAY.print.toLowerCase());

  if (isMatch) {
    setStatus(WIN_STATUS_MESSAGE);
    gameOver = true;
  } else if (currentGuess >= MAX_GUESSES) {
    setStatus(LOSE_STATUS_MESSAGE);
    gameOver = true;
  }
}

async function init() {
  await Promise.all([loadMapping(), loadDailyWords()]);

  if (allWords.length > 0) {
    WORD_OF_THE_DAY = getWordForDayIndex(todayDayIndex());
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
