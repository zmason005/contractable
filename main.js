"use strict";

/*
  Security Note:
  This file does not evaluate user input as code.
  All input is validated against an explicit mapping table.
*/

const WORD_OF_THE_DAY = "a6ect"; // test word
const MAX_GUESSES = 6;

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

  debug("mapping loaded");
}

/* ---------------- Debug ---------------- */

function debug(msg) {
  document.getElementById("debug").textContent = msg;
}

/* ---------------- Utilities ---------------- */

/*
  Convert a user-entered string into mapped braille cells.
  Ignores unmapped / invisible characters.
*/
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

/*
  A valid guess:
  - resolves to exactly 5 mapped braille cells
*/
function validateGuess(str) {
  const mapped = mapStringToDots(str);

  if (mapped.length !== 5) {
    debug(`invalid length: ${mapped.length} cells`);
    return false;
  }

  debug("guess accepted");
  return true;
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
        .toString(2).padStart(6, "0");

    wrongDots[i] =
      (parseInt(wrongDots[i], 2) | wrong)
        .toString(2).padStart(6, "0");
  }

  renderRow(formatRow({
    guessIndex: currentGuess,
    correct: dotsArrayToAsciiString(correctDots),
    guess: rawGuess,
    wrong: dotsArrayToAsciiString(wrongDots)
  }));

  currentGuess++;
  input.value = "";

  if (rawGuess === WORD_OF_THE_DAY || currentGuess >= MAX_GUESSES) {
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
