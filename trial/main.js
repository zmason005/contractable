"use strict";

/* Security Note: This file does not evaluate user input as code.
   All data input is translated safely via strict indexing lookups. */

const MAX_GUESSES = 6;
// Day 0 anchor epoch constant point tracking = 2026-03-25 UTC midnight
const START_DATE_MS = 1774396800000;

/* ── Universal Multi-Mode Conversion Matrices ───────────────────────────── */
let unicodeToBits = {};
let brailleAsciiToBits = {};
let printAsciiToBits = {};
let bitsToUnicode = {};

let WORD_OF_THE_DAY_UNICODE = ""; // Target active secret 5-cell game sequence string
let WORD_OF_THE_DAY_PRINT = "";   // Target standard English text word variant
let allWords = [];                // Loaded reference vocabulary array containing entry rows
let currentGuess = 0;
let gameOver = false;

// Per-cell state arrays initialized to standard empty 8-bit tracking masks
let correctDots = Array(5).fill("00000000");
let wrongDots = Array(5).fill("00000000");

/* ── Row Labeling Dictionary (True Braille Unicode) ──────────────────────── */
const ROW_IDENTIFIERS_UNICODE = {
  1: "⠼⠁", // Number Sign + Dot 1 (a) -> 1
  2: "⠼⠃", // Number Sign + Dots 1-2 (b) -> 2
  3: "⠼⠉", // Number Sign + Dots 1-4 (c) -> 3
  4: "⠼⠙", // Number Sign + Dots 1-4-5 (d) -> 4
  5: "⠼⠑", // Number Sign + Dots 1-5 (e) -> 5
  6: "⠼⠋", // Number Sign + Dots 1-2-4 (f) -> 6
  "final": "⠋⠼⠁⠇⠀⠛⠥⠑⠵" // "f9al guez" in Unified English Braille Unicode
};

// Direct debug communication window for local device screening diagnostics
function mobileLog(msg) {
  const log = document.getElementById("debug-log");
  if (log) log.textContent += msg + "\n";
  console.error(msg);
}

/* ── PRNG Engine Logic & Seed Distribution ────────────────────────────── */
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
    const temp = a[i];
    a[i] = a[j];
    a[j] = temp;
  }
  return a;
}

function getDayIndex() {
  const now = Date.now();
  const delta = now - START_DATE_MS;
  if (delta < 0) return 0;
  return Math.floor(delta / (1000 * 60 * 60 * 24));
}

/* ── Mapping Compilation & Setup Routines ──────────────────────────────── */
async function loadMapping() {
  try {
    const response = await fetch("brlunicode-mapping.json");
    if (!response.ok) throw new Error("Unified table asset file could not be read.");
    const mappingArray = await response.json();
    
    unicodeToBits = {};
    brailleAsciiToBits = {};
    printAsciiToBits = {};
    bitsToUnicode = {};
    
    mappingArray.forEach(row => {
      const mask = row.bitmask;
      
      // 1. Direct Visual Unicode string indices parsing loop
      if (row.unicodeChar) {
        unicodeToBits[row.unicodeChar] = mask;
      }
      
      // 2. 6-dot Classical Braille ASCII keyboard layout mapping configuration 
      if (row.brailleAscii) {
        brailleAsciiToBits[row.brailleAscii] = mask;
      }
      
      // 3. Print mapping with case-insensitive protection insurance 
      if (row.printAscii) {
        printAsciiToBits[row.printAscii] = mask;
        printAsciiToBits[row.printAscii.toLowerCase()] = mask;
      }
      
      // 4. Inverse translation resolution (Mask -> Unified Display Character)
      bitsToUnicode[mask] = row.unicodeChar;
      // Graceful fallback option mapping for stripped 6-bit input structures
      bitsToUnicode[mask.slice(-6)] = row.unicodeChar;
    });
  } catch (e) {
    mobileLog("Initialization Matrix Generation Faulted: " + e.message);
    throw e;
  }
}

// Multi-mode cascading character analyzer logic routing safely
function getBitmaskFromChar(char) {
  if (!char) return "00000000";
  
  // Cascades: Unicode -> Braille ASCII Table Layout Key -> Standard Alphabetic Latin Print Character
  const mask = unicodeToBits[char] || brailleAsciiToBits[char] || printAsciiToBits[char];
  if (mask) return mask;
  
  // Return clean zero tracking bit state array if an invalid or unmapped value occurs
  return "00000000";
}

async function init() {
  try {
    await loadMapping();
    
    const response = await fetch("daily-word2.json");
    if (!response.ok) throw new Error("Failed to pull active game dictionary manifest array.");
    const rawWords = await response.json();
    
    if (!rawWords || rawWords.length === 0) {
      throw new Error("Target master list dictionary array evaluated as clear or corrupted.");
    }
    
    allWords = rawWords;
    
    const dayIndex = getDayIndex();
    const shuffleSeed = 10432; 
    const shuffled = deterministicShuffle(allWords, shuffleSeed);
    
    const wordObj = shuffled[dayIndex % shuffled.length];
    
    // Assign targets cleanly for back-end evaluation routines
    WORD_OF_THE_DAY_UNICODE = wordObj.brlunicode;
    WORD_OF_THE_DAY_PRINT = wordObj.print.toLowerCase();
    
    setupGrid();
    setupInputHandling();
    
    const status = document.getElementById("status");
    if (status) status.textContent = "Application loaded successfully. Focus target entry row field active.";
  } catch (err) {
    mobileLog("Critical Startup Failure sequence triggered: " + err.message);
    const status = document.getElementById("status");
    if (status) status.textContent = "Critical operational table reading error. Check connection properties.";
  }
}

/* ── DOM Layout Interacting Generation Setup ──────────────────────────── */
function setupGrid() {
  const board = document.getElementById("game-board");
  if (!board) return;
  board.innerHTML = "";
  
  for (let r = 0; r < MAX_GUESSES; r++) {
    const rowEl = document.createElement("div");
    rowEl.className = "board-row";
    rowEl.id = `row-${r}`;
    rowEl.setAttribute("role", "text");
    rowEl.setAttribute("tabindex", "-1");
    
    // Add true Braille Unicode Row Index Prefix
    const rowLabel = document.createElement("div");
    rowLabel.className = "row-number-indicator";
    rowLabel.setAttribute("aria-hidden", "true");
    const trackingKey = (r === 5) ? "final" : (r + 1);
    rowLabel.textContent = ROW_IDENTIFIERS_UNICODE[trackingKey];
    rowEl.appendChild(rowLabel);
    
    for (let c = 0; c < 5; c++) {
      const cellEl = document.createElement("div");
      cellEl.className = "board-cell";
      cellEl.id = `cell-${r}-${c}`;
      cellEl.setAttribute("aria-hidden", "true");
      cellEl.textContent = "⠀"; // Pad tracking board layout structures with U+2800 at boot
      rowEl.appendChild(cellEl);
    }
    board.appendChild(rowEl);
  }
}

function setupInputHandling() {
  const input = document.getElementById("guess-input");
  const form = document.getElementById("guess-form");
  if (!input || !form) return;
  
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (gameOver) return;
    
    const val = (input.value || "").trim().toLowerCase();
    
    // 1. Convert user's input stream directly into 8-bit comparison masks
    const rawChars = Array.from(val);
    const bitmasks = rawChars.map(c => getBitmaskFromChar(c));
    
    // 2. Filter out non-braille blank placeholders or broken keystrokes
    const validCells = bitmasks.filter(mask => mask !== "00000000" && mask !== "");
    
    // 3. Post-conversion check: Measure physical BRAILLE CELLS, not arbitrary letters
    if (validCells.length !== 5) {
      showError("Invalid: Must be 5 Braille cells.");
      return;
    }
    
    // 4. Dictionary Check: Evaluate print entry fields to maintain Grade 2 flexibility
    const matchedWord = allWords.find(w => w.print.toLowerCase() === val);
    if (!matchedWord) {
      showError("Word not in dictionary.");
      return;
    }
    
    // Run the validated 5-cell Unicode string straight into the processing grid
    submitGuess(matchedWord.brlunicode);
    input.value = "";
  });
}

function showError(msg) {
  const alertContainer = document.getElementById("custom-alert-container");
  const alertText = document.getElementById("custom-alert-text");
  if (!alertContainer || !alertText) return;
  
  alertText.textContent = msg;
  alertContainer.classList.remove("hidden-alert");
  
  const status = document.getElementById("status");
  if (status) status.textContent = `Alert popup warning: ${msg}`;
  
  setTimeout(() => {
    alertContainer.classList.add("hidden-alert");
  }, 4000);
}

/* ── Universal Binary Match Logic Core Execution ───────────────────────── */
function submitGuess(verifiedUnicodeGuess) {
  const guessChars = Array.from(verifiedUnicodeGuess);
  const targetChars = Array.from(WORD_OF_THE_DAY_UNICODE);
  
  const rowEl = document.getElementById(`row-${currentGuess}`);
  if (!rowEl) return;
  
  const guessMasks = guessChars.map(c => getBitmaskFromChar(c));
  const targetMasks = targetChars.map(c => getBitmaskFromChar(c));
  
  const evaluations = Array(5).fill("absent");
  const targetAllocated = Array(5).fill(false);
  const guessAllocated = Array(5).fill(false);
  
  // Pass 1: True exact cell equality verification matching check loop ("correct")
  for (let i = 0; i < 5; i++) {
    if (guessMasks[i] === targetMasks[i]) {
      evaluations[i] = "correct";
      targetAllocated[i] = true;
      guessAllocated[i] = true;
      correctDots[i] = guessMasks[i]; 
    }
  }
  
  // Pass 2: Position displacement indexing loops checking verification states ("present")
  for (let i = 0; i < 5; i++) {
    if (guessAllocated[i]) continue;
    for (let j = 0; j < 5; j++) {
      if (!targetAllocated[j] && guessMasks[i] === targetMasks[j]) {
        evaluations[i] = "present";
        targetAllocated[j] = true;
        break;
      }
    }
  }
  
  // Generate unbroken string outputs to completely eliminate layout element brackets
  let unicodeOutputWord = "";
  let speechOutputString = "";
  
  for (let i = 0; i < 5; i++) {
    const cell = document.getElementById(`cell-${currentGuess}-${i}`);
    
    // Force strict Unicode map resolution, falling back to U+2800 Braille space if needed
    const uniformVisualGlyph = bitsToUnicode[guessMasks[i]] || "⠀";
    unicodeOutputWord += uniformVisualGlyph;
    speechOutputString += `${uniformVisualGlyph} is ${evaluations[i]}. `;
    
    if (cell) {
      cell.textContent = uniformVisualGlyph;
      cell.className = `board-cell ${evaluations[i]}`; // Overwrite cleanly
    }
  }
  
  // Inject clean unified row attributes to eliminate multi-element rendering glitches
  rowEl.setAttribute("aria-braillelabel", unicodeOutputWord);
  rowEl.setAttribute("aria-label", `Guess row ${currentGuess + 1}: ${speechOutputString}`);
  rowEl.focus();
  
  const isWin = evaluations.every(v => v === "correct");
  const status = document.getElementById("status");
  
  if (isWin) {
    gameOver = true;
    if (status) status.textContent = `,,y ,,w96. Puzzle solved in row configuration index ${currentGuess + 1}.`;
    return;
  }
  
  currentGuess++;
  
  if (currentGuess >= MAX_GUESSES) {
    gameOver = true;
    if (status) status.textContent = `,sorry1 ! ~w 0 ${WORD_OF_THE_DAY_UNICODE}`;
    return;
  }
}

document.addEventListener("DOMContentLoaded", init);
