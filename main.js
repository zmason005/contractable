"use strict";

/*
  Security Note:
  This file does not evaluate user input as code.
  All input is validated against an explicit mapping table.
*/

const MAX_GUESSES = 6;

let asciiToDots = {};
let dotsToAscii = {};

let dailyWords = [];
let WORD_OF_THE_DAY = "";

let currentGuess = 0;
let gameOver = false;

// per-position persistent fields
let correctDots = Array(5).fill("000000");
let wrongDots   = Array(5).fill("000000");

/* ---------------- Mapping Loader ---------------- */

async function loadMapping() {
  const response = await fetch("braille-ascii-map.json");
  const data = await response.json();

  asciiToDots = data;

  for (const [ascii, dots] of Object.entries(data)) {
    dotsToAscii[dots] = ascii;
  }
}

/* ---------------- Daily Word Loader ---------------- */

async function loadDailyWords() {
  const response = await fetch("daily-words.json");
  const data = await response.json();

  dailyWords = Object
    .keys(data)
    .sort((a, b) => Number(a) - Number(b))
    .map(key => data[key]);

  selectWordOfTheDay();
}

function selectWordOfTheDay() {
  const epoch = new Date("2026-01-01");
  const today = new Date();

  const msPerDay = 1000 * 60 * 60 * 24;
  const dayNumber = Math.floor((today - epoch) / msPerDay);

  const index = dayNumber % dailyWords.length;

  WORD_OF_THE_DAY = dailyWords[index].ascii;
}

/* ---------------- Status Helpers ---------------- */

function setStatus(msg) {
  const status = document.getElementById("status");
  status.textContent = msg;

  setTimeout(() => {
    status.focus();
  }, 0);
}

/* ---------------- Guess Label ---------------- */

function updateGuessLabel() {
  const label = document.getElementById("guess-label");

  if (currentGuess === MAX_GUESSES - 1) {
    label.textContent = "f9al guess ";
  } else {
    label.textContent = "guess";
  }
}

/* ---------------- Utilities ---------------- */

function mapStringToDots(str) {
  const dots = [];

  for (const ch of str) {
    if (asciiToDots.hasOwnProperty(ch)) {
      dots.push(asciiToDots[ch]);
    }
  }

  return dots;
}

function dotsArrayToAsciiString(arr) {
  return arr.map(d => dotsToAscii[d] || " ").join("");
}

function validateGuess(str) {
  return mapStringToDots(str).length === 5;
}

function guessLabel(index) {
  if (index < 6) {
    return `#${String.fromCharCode(97 + index)}`;
  }
  return "";
}

/* ---------------- Row Formatting ---------------- */

function formatRow({ guessIndex, correct, guess, wrong }) {
  const label = guessLabel(guessIndex);
  return `${label} ${correct} ${guess} ${wrong}`;
}

/* ---------------- Rendering ---------------- */

function renderRow(rowText) {
  const board = document.getElementById("game-board");

  const row = document.createElement("div");
  row.className = "row";
  row.tabIndex = -1;
  row.textContent = rowText;

  board.appendChild(row);
  row.focus();
}

/* ---------------- Game Logic ---------------- */

function endGame() {
  gameOver = true;
  document.getElementById("guess-input").disabled = true;
  document.getElementById("submit-btn").disabled = true;
}

function submitGuess() {
  if (gameOver) return;

  const input = document.getElementById("guess-input");
  const rawGuess = input.value;

  if (!validateGuess(rawGuess)) {
    return;
  }

  const guessDots  = mapStringToDots(rawGuess);
  const targetDots = mapStringToDots(WORD_OF_THE_DAY);

  for (let i = 0; i < 5; i++) {
    const g = parseInt(guessDots[i], 2);
    const t = parseInt(targetDots[i], 2);

    const overlap = g & t;
    const wrong   = g & ~t;

    correctDots[i] =
      (parseInt(correctDots[i], 2) | overlap)
        .toString(2)
        .padStart(6, "0");

    wrongDots[i] =
      (parseInt(wrongDots[i], 2) | wrong)
        .toString(2)
        .padStart(6, "0");
  }

  renderRow(formatRow({
    guessIndex: currentGuess,
    correct: dotsArrayToAsciiString(correctDots),
    guess: rawGuess,
    wrong: dotsArrayToAsciiString(wrongDots)
  }));

  currentGuess++;
  input.value = "";

  updateGuessLabel();

  if (rawGuess === WORD_OF_THE_DAY) {
    setStatus(",,y ,,w96");
    endGame();
    return;
  }

  if (currentGuess >= MAX_GUESSES) {
    const todays = dailyWords.find(w => w.ascii === WORD_OF_THE_DAY);
    setStatus(`,sorry1 ! ~w 0 ${todays.print}`);
    endGame();
  }
}

/* ---------------- Init ---------------- */

const input  = document.getElementById("guess-input");
const button = document.getElementById("submit-btn");

button.addEventListener("click", submitGuess);

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    submitGuess();
  }
});

async function init() {
  await loadMapping();
  await loadDailyWords();

  updateGuessLabel();
  input.focus();
}

init();

/* =====================================================
   TEMPORARY DIAGNOSTIC MODE
   Braille Wordle JSON Loader Debugger
   Remove after troubleshooting
   ===================================================== */

const DEBUG = true;

function debugLog(...msg) {
  if (DEBUG) console.log("[BRAILLE WORDLE DEBUG]", ...msg);
}

function debugError(...msg) {
  console.error("[BRAILLE WORDLE ERROR]", ...msg);
}

function debugWarn(...msg) {
  console.warn("[BRAILLE WORDLE WARNING]", ...msg);
}


/* -----------------------------------------------------
   1. LOAD DAILY WORD FILE
----------------------------------------------------- */

async function loadDailyWords() {

  debugLog("Starting JSON load...");

  let response;

  try {
    response = await fetch("daily-words.json");
  } catch (err) {
    debugError("Fetch failed:", err);
    return null;
  }

  debugLog("Fetch response status:", response.status);

  if (!response.ok) {
    debugError("JSON file failed to load.");
    debugError("Check file path and server permissions.");
    return null;
  }

  let words;

  try {
    words = await response.json();
  } catch (err) {
    debugError("JSON parsing failed.");
    debugError(err);
    return null;
  }

  debugLog("JSON loaded successfully.");
  debugLog("Total words:", words.length);

  if (!Array.isArray(words)) {
    debugError("JSON structure invalid: expected an array.");
    return null;
  }

  if (words.length === 0) {
    debugError("Word list is empty.");
    return null;
  }

  debugLog("First 5 entries:");

  words.slice(0,5).forEach((w,i)=>{
    debugLog(i, w);
  });

  return words;
}


/* -----------------------------------------------------
   2. DAY INDEX CALCULATION CHECK
----------------------------------------------------- */

function calculateDayIndex(wordCount) {

  const epoch = new Date("2024-01-01"); // adjust if needed
  const today = new Date();

  const msPerDay = 86400000;

  const daysSinceEpoch =
    Math.floor((today - epoch) / msPerDay);

  debugLog("Days since epoch:", daysSinceEpoch);

  const dayIndex = daysSinceEpoch % wordCount;

  debugLog("Calculated day index:", dayIndex);

  return dayIndex;
}


/* -----------------------------------------------------
   3. VALIDATE WORD ENTRY
----------------------------------------------------- */

function validateWordEntry(entry, index) {

  if (!entry.print)
    debugWarn("Missing PRINT word at index", index);

  if (!entry.ascii)
    debugWarn("Missing ASCII word at index", index);

  if (entry.ascii && entry.ascii.length !== 5) {
    debugWarn(
      "ASCII word length not 5",
      index,
      entry.ascii,
      entry.ascii.length
    );
  }

  if (entry.ascii) {

    const badChars =
      entry.ascii.match(/[^a-z]/g);

    if (badChars) {
      debugWarn(
        "Non-lowercase ASCII detected",
        index,
        entry.ascii,
        badChars
      );
    }
  }
}


/* -----------------------------------------------------
   4. SELECT DAILY ANSWER
----------------------------------------------------- */

async function loadAnswer() {

  const words = await loadDailyWords();

  if (!words) {
    debugError("Cannot continue without word list.");
    return null;
  }

  words.forEach(validateWordEntry);

  const dayIndex = calculateDayIndex(words.length);

  const entry = words[dayIndex];

  debugLog("Selected entry:", entry);

  if (!entry) {
    debugError("Entry undefined at index", dayIndex);
    return null;
  }

  const answer = entry.ascii;

  debugLog("Selected ASCII answer:", answer);

  if (!answer) {
    debugError("ASCII answer missing.");
  }

  if (answer && answer.length !== 5) {
    debugWarn("Answer length not 5:", answer);
  }

  return answer;
}


/* -----------------------------------------------------
   5. RUN DIAGNOSTIC TEST
----------------------------------------------------- */

(async function runDiagnostics(){

  debugLog("Running startup diagnostics...");

  const answer = await loadAnswer();

  if (!answer) {
    debugError("Answer generation failed.");
    return;
  }

  debugLog("Final resolved answer:", answer);

})();
