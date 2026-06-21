"use strict";

const MAX_GUESSES = 6;
const START_DATE_MS = 1774396800000; // Day 0 = 2026-03-25

let WORD_OF_THE_DAY = null; // Holds target object: { id, print, brlunicode }
let allWords = [];          // Master array from daily-word2.json
let asciiToDots = {};       // Maps print letters and Braille Unicode to 8-bit binary strings
let dotsToAscii = {};       // Maps 8-bit binary strings to Braille Unicode symbols

let currentGuess = 0;
let gameOver = false;

// Trackers initialized as pure integers to leverage clean bitwise masks
let correctDots = Array(5).fill(0);
let wrongDots = Array(5).fill(0);

// Unified logger for debugging and device runtimes
function mobileLog(msg) {
  const log = document.getElementById("debug-log");
  if (log) log.textContent += msg + "\n";
  console.error(msg);
}

/* ── PRNG & DETERMINISTIC SHUFFLE ENGINE ────────────────────────────────── */

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
  const shuffled = arr.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const temp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = temp;
  }
  return shuffled;
}

function getWordForDayIndex(dayIndex) {
  if (allWords.length === 0) return null;
  const shuffled = deterministicShuffle(allWords, 42139); // Stable structural seed
  const safeIndex = dayIndex % shuffled.length;
  return shuffled[safeIndex];
}

/* ── BIDIRECTIONAL TRANSLATION & DATA PARSING ───────────────────────────── */

function mapStringToDots(str) {
  const dotsArray = [];
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    // Check direct Unicode Braille key first, then fallback to lowercase letter mapping
    if (asciiToDots[ch] !== undefined) {
      dotsArray.push(asciiToDots[ch]);
    } else if (asciiToDots[ch.toLowerCase()] !== undefined) {
      dotsArray.push(asciiToDots[ch.toLowerCase()]);
    } else {
      dotsArray.push("00000000"); // Safe structural fallback mask
    }
  }
  return dotsArray;
}

function stringToUnicodeSymbols(str) {
  let unicodeResult = "";
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (asciiToDots[ch] !== undefined) {
      // If it's already a native Braille symbol, preserve it directly
      unicodeResult += ch;
    } else {
      const lowerCh = ch.toLowerCase();
      const dotBits = asciiToDots[lowerCh];
      if (dotBits && dotsToAscii[dotBits]) {
        unicodeResult += dotsToAscii[dotBits];
      } else {
        unicodeResult += "⠀"; // Blank cell fallback (U+2800)
      }
    }
  }
  return unicodeResult;
}

/* ── ACCESSIBILITY SPLIT-STREAM STATUS SYSTEM ───────────────────────────── */

function setStatus(ariaLabelText, ariaBraillelabelText) {
  const statusContainer = document.getElementById("status");
  if (!statusContainer) return;

  // Clear existing content safely
  statusContainer.textContent = "";

  // Set the precise, clean straight-quoted accessibility properties
  statusContainer.setAttribute("aria-label", ariaLabelText);
  statusContainer.setAttribute("aria-braillelabel", ariaBraillelabelText);

  // Focus Tree Race Mitigation: Delay layout announcement focus shift slightly 
  // to prevent mobile speech engines from clipping ongoing row confirmation signals.
  setTimeout(() => {
    statusContainer.focus();
  }, 250);
}

/* ── ASYNC DATA LAYER ROUTINES ──────────────────────────────────────────── */

async function loadDailyWords() {
  try {
    const response = await fetch("daily-word2.json");
    if (!response.ok) throw new Error("Network response failed");
    allWords = await response.json();
  } catch (e) {
    setStatus(
      "Administrative error. Please send an email to the web administrator info@braillefirst.com.",
      ""
    );
    mobileLog("Daily Words Error: " + e.message);
  }
}

async function loadMapping() {
  try {
    const response = await fetch("brlunicode-mapping.json");
    if (!response.ok) throw new Error("Network response failed");
    const data = await response.json();

    // Map object properties explicitly for both uncontracted and contracted execution tables
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        const item = data[key];
        const binaryString = item.bits; // Expected 8-bit mapping flag
        const unicodeSymbol = item.unicode;

        asciiToDots[key] = binaryString;
        asciiToDots[unicodeSymbol] = binaryString;
        dotsToAscii[binaryString] = unicodeSymbol;
      }
    }
  } catch (e) {
    setStatus(
      "Administrative error. Please send an email to the web administrator info@braillefirst.com.",
      ""
    );
    mobileLog("Mapping Error: " + e.message);
  }
}

/* ── GRID PRESENTATION ENGINE ───────────────────────────────────────────── */

function formatRow(guessUnicode, trackerUnicode) {
  // Generates flat presentational fragments matching native column structures
  let html = "";
  
  // Column 1: Tracker Field
  html += `<span class="cell-block c1" role="text" aria-hidden="true">${trackerUnicode}</span>`;
  // Transparent Space Gutter 1
  html += `<span class="gutter-space" aria-hidden="true"> </span>`;
  // Column 2: Guess Core Matrix
  html += `<span class="cell-block c2" role="text" aria-hidden="true">${guessUnicode}</span>`;
  
  return html;
}

function renderRow(rowIndex, guessUnicode, trackerUnicode, speechLabel, tactileLabel) {
  const rowElement = document.getElementById(`row-${rowIndex}`);
  if (!rowElement) return;

  // Enforce semantic node flattening for screen readers via role="text"
  rowElement.setAttribute("role", "text");
  rowElement.setAttribute("aria-label", speechLabel);
  rowElement.setAttribute("aria-braillelabel", tactileLabel);

  rowElement.innerHTML = formatRow(guessUnicode, trackerUnicode);
}

/* ── DOM CORE GAME LOOP INTERACTION ENGINE ──────────────────────────────── */

function submitGuess() {
  if (gameOver || !WORD_OF_THE_DAY) return;

  const inputElement = document.getElementById("guess-input");
  if (!inputElement) return;

  const rawGuess = inputElement.value.trim();
  
  // Guardrail: Structural confirmation of entry metrics
  if (rawGuess.length !== 5) {
    setStatus(
      "INVALID: Must be 5 braille characters",
      "⠠⠠⠔⠧⠁⠇⠊⠙⠒⠀⠠⠍⠌⠀⠆⠀⠼⠑⠀⠃⠗⠇⠀⠐⠡⠎"
    );
    return;
  }

  // Parse arrays into binary string formats natively
  const guessDotsArray = mapStringToDots(rawGuess);
  const targetDotsArray = mapStringToDots(WORD_OF_THE_DAY.brlunicode);

  const guessUnicode = stringToUnicodeSymbols(rawGuess);
  const targetUnicode = stringToUnicodeSymbols(WORD_OF_THE_DAY.brlunicode);
  
  let trackerUnicode = "";
  let exactMatches = 0;

  // Process evaluation loops using mathematical bitwise shifts
  for (let i = 0; i < 5; i++) {
    const guessBits = parseInt(guessDotsArray[i], 2);
    const targetBits = parseInt(targetDotsArray[i], 2);

    // Filter absolute correct pins
    const correctOverlap = guessBits & targetBits;
    correctDots[i] |= correctOverlap;

    // Filter invalid pins via targeted bitwise complement intersection masks
    const wrongOverlap = guessBits & ~targetBits;
    wrongDots[i] |= wrongOverlap;

    // Verify positional accuracy by matching exact Unicode output targets
    if (guessUnicode[i] === targetUnicode[i]) {
      exactMatches++;
    }

    // Determine what display dots remain out of the master target sequence
    const trackerBits = targetBits & ~correctDots[i];
    const trackerBinaryStr = trackerBits.toString(2).padStart(8, "0");
    trackerUnicode += dotsToAscii[trackerBinaryStr] || "⠀";
  }

  // Generate localized, flat aria speech and tactile tracking confirmations
  const rowSpeechLabel = `Row ${currentGuess + 1}: ${rawGuess.split("").join(" ")}`;
  const rowTactileLabel = `${trackerUnicode} ${guessUnicode}`;

  renderRow(currentGuess, guessUnicode, trackerUnicode, rowSpeechLabel, rowTactileLabel);

  // Clear inputs smoothly without locking interaction wrappers
  inputElement.value = "";
  currentGuess++;

  // Assess termination triggers
  if (exactMatches === 5) {
    gameOver = true;
    setStatus(
      "YOU WIN!",
      "⠠⠠⠽⠀⠠⠠⠺⠔⠖"
    );
  } else if (currentGuess >= MAX_GUESSES) {
    gameOver = true;
    // Inject dynamic word reveals safely via split-concatenation straight quotes
    const speechDefeat = "Sorry, game over. The word was " + WORD_OF_THE_DAY.print;
    const tactileDefeat = "⠠⠎⠕⠗⠗⠽⠂⠀⠛⠁⠍⠑⠀⠕⠧⠻⠲⠀⠠⠮⠀⠘⠺⠀" + WORD_OF_THE_DAY.brlunicode;
    setStatus(speechDefeat, tactileDefeat);
  } else {
    // Standard turn update loop text
    setStatus(`Guess ${currentGuess} submitted.`, "");
    
    // Focus next physical row to prompt linear hardware traversal
    const nextRow = document.getElementById(`row-${currentGuess}`);
    if (nextRow) {
      setTimeout(() => { nextRow.focus(); }, 100);
    }
  }
}

/* ── MASTER ENTRYPOINT INITIALIZATION ───────────────────────────────────── */

async function init() {
  await loadDailyWords();
  await loadMapping();

  if (allWords.length === 0) {
    setStatus(
      "Administrative error. Please send an email to the web administrator info@braillefirst.com.",
      ""
    );
    mobileLog("Critical: No words loaded. Check JSON files.");
    return;
  }

  // Synchronize dynamic daily index calculation formulas
  const nowMs = Date.now();
  const deltaMs = nowMs - START_DATE_MS;
  const currentDayIndex = Math.max(0, Math.floor(deltaMs / (1000 * 60 * 60 * 24)));

  WORD_OF_THE_DAY = getWordForDayIndex(currentDayIndex);

  if (!WORD_OF_THE_DAY) {
    mobileLog("Initialization Error: Target word assignment failed structural mapping limits.");
    return;
  }

  // Bind interaction event loops cleanly
  const submitBtn = document.getElementById("submit-btn");
  if (submitBtn) {
    submitBtn.addEventListener("click", submitGuess);
  }

  const inputField = document.getElementById("guess-input");
  if (inputField) {
    inputField.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        submitGuess();
      }
    });
  }
}

// Global invocation pipeline
document.addEventListener("DOMContentLoaded", () => {
  init().catch((e) => {
    mobileLog("Init Error: " + e.message);
  });
});
