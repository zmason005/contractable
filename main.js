"use strict";

/*
  Security Note:
  This file does not evaluate user input as code.
  All input is length-checked and character-validated.
*/

const WORD_OF_THE_DAY = "a6ect"; // test word (ascii)
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
}

/* ---------------- Utilities ---------------- */

function asciiStringToDotsArray(str) {
  return [...str].map(ch => asciiToDots[ch] || null);
}

function dotsArrayToAsciiString(arr) {
  return arr.map(d => dotsToAscii[d] || " ").join("");
}

function validateGuess(str) {
  if (str.length !== 5) return false;
  return [...str].every(ch => asciiToDots.hasOwnProperty(ch));
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

/* ---------- Row Format Self-Test (Dev Guardrail) ---------- */
(function rowFormatSelfTest() {
  const EMPTY = "-----";

  const test = formatRow({
    guessIndex: 0,
    correct: EMPTY,
    guess: "about",
    wrong: EMPTY
  });

  console.assert(typeof test === "string",
    "formatRow must return a string");

  const parts = test.split(" ");

  console.assert(parts.length === 4,
    "Row must contain exactly 4 space-separated fields");

  console.assert(parts[1].length === 5,
    "Correct field must be exactly 5 cells wide");

  console.assert(parts[2].length === 5,
    "Guess field must be exactly 5 cells wide");

  console.assert(parts[3].length === 5,
    "wr;g field must be exactly 5 cells wide");
})();

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
  const guess = input.value;

  if (!validateGuess(guess)) {
    return;
  }

  const guessDots = asciiStringToDotsArray(guess);
  const targetDots = asciiStringToDotsArray(WORD_OF_THE_DAY);

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
    guess,
    wrong: dotsArrayToAsciiString(wrongDots)
  }));

  currentGuess++;
  input.value = "";

  if (guess === WORD_OF_THE_DAY || currentGuess >= MAX_GUESSES) {
    endGame();
  }
}

/* ---------------- Init ---------------- */

const input = document.getElementById("guess-input");
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
