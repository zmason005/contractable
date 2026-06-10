"use strict";

const MAX_GUESSES = 6;
const START_DATE_MS = 1774396800000; // Day 0 = 2026-03-25

let WORD_OF_THE_DAY = null; // Target shape: { id, print, brlunicode }
let allWords = []; 
let asciiToDots = {}; 
let dotsToAscii = {}; 
let currentGuess = 0; 
let gameOver = false;

let correctDots = Array(5).fill("00000000"); 
let wrongDots = Array(5).fill("00000000"); 

const WIN_STATUS_MESSAGE = "⠄⡳⠭⠴⠴⠢⠔⠄⠄⠠⠽⠕⠥⠠⠺⠊⠝⠖"; 
const LOSE_STATUS_MESSAGE = "⠠⠎⠕⠗⠗⠽⠖"; 

const ROW_NUMERIC_PREFIXES = [
  "⠼⠁", // Row 1
  "⠼⠃", // Row 2
  "⠼⠉", // Row 3
  "⠼⠙", // Row 4
  "⠼⠑", // Row 5
  "⠼⠋"  // Row 6
];

function mobileLog(msg) {
  const log = document.getElementById("debug-log");
  if (log) log.textContent += msg + "\n";
  console.error(msg);
}

/* ── PRNG & Game Index Core ──────────────────────────────────────────────── */
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

function getWordForDayIndex(wordsArray, dayIndex) {
  if (!wordsArray || wordsArray.length === 0) return null;
  const seed = dayIndex + 1000; 
  const rng = mulberry32(seed);
  const randomIndex = Math.floor(rng() * wordsArray.length);
  return wordsArray[randomIndex];
}

/* ── Formatter Engine (Option B Layer Realization) ────────────────────────── */
function formatRow({ guessIndex, correct, guess, wrong }) {
  const label = guessIndex < 6 ? ROW_NUMERIC_PREFIXES[guessIndex] : "⠠⠠"; 
  
  // Total string allocation matches precisely 22 spacing cells:
  // label(2ch) + space(1ch) + correct(5ch) + space(1ch) + guess(5ch) + space(1ch) + wrong(5ch) + margin(2ch)
  const textPayload = `${label} ${correct} ${guess} ${wrong}  `;

  // Output two clean stacked layers. The background spans are hidden from assistive nodes.
  const htmlStr = `
    <div class="row-bg" aria-hidden="true">
      <span class="bg-c1"></span><span class="bg-s1"></span>
      <span class="bg-c2"></span><span class="bg-s2"></span>
      <span class="bg-c3"></span><span class="bg-margin"></span>
    </div>
    <div class="row-text">${textPayload}</div>
  `.trim();

  return htmlStr;
}

function renderRow(containerId, rowData) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const rowDiv = document.createElement("div");
  rowDiv.className = "row";
  rowDiv.tabIndex = -1; 
  
  // Clean semantic presentation for screen readers and refreshable hardware lines
  rowDiv.setAttribute("aria-label", `Row ${rowData.guessIndex + 1}`);
  
  rowDiv.innerHTML = formatRow(rowData);
  container.appendChild(rowDiv);
  
  // Focus jump logic safely preserves accessibility tracking
  setTimeout(() => rowDiv.focus(), 50);
}

/* ── Validation & Dot Track Processing ────────────────────────────────────── */
function mapStringToDots(str) {
  let dots = [];
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    dots.push(asciiToDots[ch] || "00000000");
  }
  while (dots.length < 5) {
    dots.push("00000000");
  }
  return dots.slice(0, 5);
}

function mapDotsToString(dotsArray) {
  return dotsArray.map(dots => dotsToAscii[dots] || "⠀").join("");
}

function submitGuess() {
  if (gameOver) return;

  const inputEl = document.getElementById("guess-input");
  const statusEl = document.getElementById("status");
  if (!inputEl || !statusEl) return;

  const rawGuess = inputEl.value.trim();
  
  if (rawGuess.length !== 5) {
    statusEl.textContent = "Invalid: Must be 5 Braille chars.";
    return;
  }

  const guessDots = mapStringToDots(rawGuess);
  const targetDots = mapStringToDots(WORD_OF_THE_DAY.brlunicode);

  let exactMatchTracker = Array(5).fill(false);
  let nextCorrectDots = [...correctDots];
  let nextWrongDots = [...wrongDots];

  // Evaluate Perfect Alignments (Correct Channel)
  for (let i = 0; i < 5; i++) {
    if (guessDots[i] === targetDots[i]) {
      exactMatchTracker[i] = true;
      nextCorrectDots[i] = guessDots[i];
    }
  }

  // Evaluate Inclusion Failures (Wrong Channel)
  for (let i = 0; i < 5; i++) {
    if (!exactMatchTracker[i]) {
      if (!targetDots.includes(guessDots[i])) {
        nextWrongDots[i] = guessDots[i];
      }
    }
  }

  correctDots = nextCorrectDots;
  wrongDots = nextWrongDots;

  const rowPayload = {
    guessIndex: currentGuess,
    correct: mapDotsToString(correctDots),
    guess: rawGuess,
    wrong: mapDotsToString(wrongDots)
  };

  renderRow("game-board", rowPayload);
  currentGuess++;

  inputEl.value = "";
  statusEl.textContent = "";

  // Verify State Resolution Rules
  if (rawGuess === WORD_OF_THE_DAY.brlunicode) {
    gameOver = true;
    statusEl.textContent = WIN_STATUS_MESSAGE;
    inputEl.disabled = true;
    return;
  }

  if (currentGuess >= MAX_GUESSES) {
    gameOver = true;
    statusEl.textContent = `${LOSE_STATUS_MESSAGE} ${WORD_OF_THE_DAY.brlunicode}`;
    inputEl.disabled = true;
  }
}

/* ── Lifecycle Initialization ─────────────────────────────────────────────── */
async function init() {
  try {
    const mapResponse = await fetch("brlunicode-mapping.json");
    if (!mapResponse.ok) throw new Error("Failed to load brlunicode-mapping.json");
    const mapData = await mapResponse.json();

    mapData.forEach(item => {
      const binaryStr = item.binary; 
      const unicodeChar = item.brlunicode; 
      const asciiChar = item.print;        

      if (unicodeChar) {
        asciiToDots[unicodeChar] = binaryStr;
        dotsToAscii[binaryStr] = unicodeChar;
      }
      if (asciiChar) {
        asciiToDots[asciiChar] = binaryStr;
      }
    });

    const wordsResponse = await fetch("daily-word2.json");
    if (!wordsResponse.ok) throw new Error("Failed to load daily-word2.json");
    allWords = await wordsResponse.json();

    if (allWords.length === 0) {
      mobileLog("Critical: No words loaded. Check JSON files.");
      return;
    }

    const now = Date.now();
    const diffMs = now - START_DATE_MS;
    const currentDayIndex = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

    WORD_OF_THE_DAY = getWordForDayIndex(allWords, currentDayIndex);

    if (!WORD_OF_THE_DAY) {
      mobileLog("Mapping Error: Word tracking resolution failure.");
      return;
    }

    // Bind Event Triggers
    const submitBtn = document.getElementById("submit-btn");
    const guessInput = document.getElementById("guess-input");

    if (submitBtn) submitBtn.addEventListener("click", submitGuess);
    if (guessInput) {
      guessInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") submitGuess();
      });
    }

  } catch (err) {
    mobileLog(err.message);
  }
}

document.addEventListener("DOMContentLoaded", init);
