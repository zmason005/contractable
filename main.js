"use strict";

/*
  Braille Wordle — Unicode Braille Core Logic
  ------------------------------------------
  - Input: Unicode Braille (U+2800–U+28FF)
  - Logic: dot-level bitmask accumulation
  - Output: real Braille cells
  - Accessibility: single live-region updates only
*/

const WORD_OF_THE_DAY = "⠁⠖⠑⠉⠞"; // example braille word (5 cells)
const MAX_GUESSES = 6;
const BRAILLE_BASE = 0x2800;

/* ---------------- State ---------------- */

let gameOver = false;
let currentGuess = 0;
let inputReady = false;

// accumulated dot masks per position
let correctDots = [0, 0, 0, 0, 0];
let wrongDots   = [0, 0, 0, 0, 0];

/* ---------------- Status Messages ---------------- */

const STATUS = {
  LOADING: "load9g braille map",
  INVALID_LENGTH: "guess m/ 2 exactly #e braille cells",
  INVALID_CHARS: "guess 3ta9s non braille cells",
  WIN: ",,y ,,w96",
  LOSE: "sorry game ov]"
};

function setStatus(msg) {
  document.getElementById("status").textContent = msg;
}

/* ---------------- Utilities ---------------- */

// true if char is Unicode Braille
function isBrailleChar(ch) {
  const code = ch.charCodeAt(0);
  return code >= 0x2800 && code <= 0x28FF;
}

// convert braille char → dot mask
function brailleCharToMask(ch) {
  return ch.charCodeAt(0) - BRAILLE_BASE;
}

// convert dot mask → braille char
function maskToBrailleChar(mask) {
  return String.fromCharCode(BRAILLE_BASE + mask);
}

// label for guess rows
function guessLabel(index) {
  if (index < 5) {
    return `#${String.fromCharCode(97 + index)}`;
  }
  return "f9al guess";
}

/* ---------------- Row Formatting ---------------- */

function formatRow({ guessIndex, correct, guess, wrong }) {
  return `${guessLabel(guessIndex)} ${correct} ${guess} ${wrong}`;
}

/* ---------------- Rendering ---------------- */

function renderRow(text) {
  const board = document.getElementById("game-board");

  const row = document.createElement("div");
  row.className = "row";
  row.tabIndex = -1;
  row.textContent = text;

  board.appendChild(row);
  row.focus();
}

/* ---------------- Game Control ---------------- */

function endGame() {
  gameOver = true;

  document.getElementById("guess-input").disabled = true;
  document.getElementById("submit-btn").disabled = true;
}

/* ---------------- Game Logic ---------------- */

function submitGuess() {
  if (gameOver || !inputReady) return;

  const input = document.getElementById("guess-input");
  const guess = [...input.value];

  if (guess.length !== 5) {
    setStatus(STATUS.INVALID_LENGTH);
    return;
  }

  if (!guess.every(isBrailleChar)) {
    setStatus(STATUS.INVALID_CHARS);
    return;
  }

  const target = [...WORD_OF_THE_DAY];

  for (let i = 0; i < 5; i++) {
    const gMask = brailleCharToMask(guess[i]);
    const tMask = brailleCharToMask(target[i]);

    correctDots[i] |= (gMask & tMask);
    wrongDots[i]   |= (gMask & ~tMask);
  }

  const correctStr = correctDots.map(maskToBrailleChar).join("");
  const wrongStr   = wrongDots.map(maskToBrailleChar).join("");

  renderRow(formatRow({
    guessIndex: currentGuess,
    correct: correctStr,
    guess: guess.join(""),
    wrong: wrongStr
  }));

  currentGuess++;
  input.value = "";

  if (guess.join("") === WORD_OF_THE_DAY) {
    setStatus(STATUS.WIN);
    endGame();
    return;
  }

  if (currentGuess >= MAX_GUESSES) {
    setStatus(STATUS.LOSE);
    endGame();
  }
}

/* ---------------- Init ---------------- */

function init() {
  const input = document.getElementById("guess-input");
  const button = document.getElementById("submit-btn");

  setStatus(STATUS.LOADING);

  // small delay to ensure screen readers announce loading
  setTimeout(() => {
    input.disabled = false;
    button.disabled = false;
    inputReady = true;
    input.focus();
  }, 200);

  button.addEventListener("click", submitGuess);

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitGuess();
    }
  });
}

init();
