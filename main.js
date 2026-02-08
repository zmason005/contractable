"use strict";

/*
  Braille Wordle — Core Game Logic

  STATUS MESSAGE POLICY
  ---------------------
  This version intentionally emits status messages ONLY when:
    • the player wins
    • the player loses

  No status messages are produced for invalid input or partial guesses.
  This avoids VoiceOver chatter and prevents interaction with invisible
  Unicode characters injected by assistive technology.

  braille-ascii-map.json remains the single source of truth.
*/

/* ---------------- Configuration ---------------- */

const WORD_OF_THE_DAY = "a6ect"; // test word (ascii)
const MAX_GUESSES = 6;

/* ---------------- State ---------------- */

let asciiToDots = {};
let dotsToAscii = {};

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

/* ---------------- Status Helpers ---------------- */

function setStatus(msg) {
  const el = document.getElementById("status");
  if (el) el.textContent = msg;
}

function clearStatus() {
  const el = document.getElementById("status");
  if (el) el.textContent = "";
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
  if (index < 5) {
    return `#${String.fromCharCode(97 + index)}`;
  }
  return "f9al guess";
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
  clearStatus();

  /* -------- Win / Lose Status Wiring -------- */

  if (rawGuess === WORD_OF_THE_DAY) {
    setStatus(",,y ,,w96");
    endGame();
    return;
  }

  if (currentGuess >= MAX_GUESSES) {
    setStatus(`,sorry" ^w 0 ${WORD_OF_THE_DAY}`);
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

input.focus();
loadMapping();
