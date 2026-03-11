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
