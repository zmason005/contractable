"use strict";

/* =====================================================
   BRAILLE WORDLE DEBUG BUILD
   If you see this alert, the new file loaded correctly
===================================================== */

alert("Braille Wordle debug build loaded");
console.log("Braille Wordle debug build running");

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

let correctDots = Array(5).fill("000000");
let wrongDots   = Array(5).fill("000000");

/* ---------------- Mapping Loader ---------------- */

async function loadMapping() {

  console.log("Loading braille-ascii-map.json");

  const response = await fetch("braille-ascii-map.json");

  if (!response.ok) {
    console.error("Failed to load braille-ascii-map.json");
    return;
  }

  const data = await response.json();

  asciiToDots = data;

  for (const [ascii, dots] of Object.entries(data)) {
    dotsToAscii[dots] = ascii;
  }

  console.log("Mapping loaded:", Object.keys(asciiToDots).length);
}

/* ---------------- Daily Word Loader ---------------- */

async function loadDailyWords() {

  console.log("Loading daily-words.json");

  const response = await fetch("daily-words.json");

  if (!response.ok) {
    console.error("Failed to load daily-words.json");
    return;
  }

  const data = await response.json();

  dailyWords = Object
    .keys(data)
    .sort((a, b) => Number(a) - Number(b))
    .map(key => data[key]);

  console.log("Words loaded:", dailyWords.length);

  selectWordOfTheDay();
}

function selectWordOfTheDay() {

  if (dailyWords.length === 0) {
    console.error("Word list empty");
    return;
  }

  const epoch = new Date("2026-01-01");
  const today = new Date();

  const msPerDay = 86400000;

  const dayNumber =
    Math.floor((today - epoch) / msPerDay);

  const index =
    dayNumber % dailyWords.length;

  console.log("Day number:", dayNumber);
  console.log("Word index:", index);

  WORD_OF_THE_DAY = dailyWords[index].ascii;

  console.log("Word of the day:", WORD_OF_THE_DAY);

  const mapped = mapStringToDots(WORD_OF_THE_DAY);

  console.log("Mapped cells:", mapped);

  if (mapped.length !== 5) {
    console.error(
      "Word does not map to 5 cells:",
      WORD_OF_THE_DAY,
      mapped
    );
  }
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
    label.textContent = "final guess";
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
    } else {
      console.warn("Unmapped character:", ch);
    }

  }

  return dots;
}

function dotsArrayToAsciiString(arr) {

  return arr
    .map(d => dotsToAscii[d] || " ")
    .join("");
}

function validateGuess(str) {

  const mapped = mapStringToDots(str);

  console.log("Guess mapping:", str, mapped);

  return mapped.length === 5;
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
    console.warn("Invalid guess:", rawGuess);
    return;
  }

  const guessDots  = mapStringToDots(rawGuess);
  const targetDots = mapStringToDots(WORD_OF_THE_DAY);

  if (targetDots.length !== 5) {
    console.error("Target word invalid:", WORD_OF_THE_DAY);
    return;
  }

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

    setStatus("You win!");

    endGame();

    return;
  }

  if (currentGuess >= MAX_GUESSES) {

    const todays =
      dailyWords.find(
        w => w.ascii === WORD_OF_THE_DAY
      );

    setStatus(`Sorry, the word was ${todays.print}`);

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

  console.log("Initializing game");

  await loadMapping();
  await loadDailyWords();

  console.log("Daily words loaded:", dailyWords.length);
  console.log("Word of the day:", WORD_OF_THE_DAY);

  updateGuessLabel();

  input.focus();

  console.log("Initialization complete");
}

init();
