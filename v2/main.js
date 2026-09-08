"use strict";

const MAX_GUESSES = 6;
const START_DATE_MS = 1774396800000; // Day 0 = 2026-03-25

let WORD_OF_THE_DAY = null;
let allWords = [];
let asciiToDots = {};
let dotsToAscii = {};
let currentGuess = 0;
let gameOver = false;

let correctDots = Array(5).fill(0);
let wrongDots = Array(5).fill(0);

function mobileLog(msg) {
  const log = document.getElementById("debug-log");
  if (log) log.textContent += msg + "\n";
  console.error(msg);
}

function unicodeStringToBitmasks(unicodeStr) {
  const bitmasks = [];
  for (let i = 0; i < 5; i++) {
    const char = unicodeStr[i] || "⠀";
    const mask = asciiToDots[char] || "00000000";
    bitmasks.push(mask);
  }
  return bitmasks;
}

function dotsArrayToAsciiString(bitmaskArray) {
  return bitmaskArray
    .map(mask => dotsToAscii[mask] || "⠀")
    .join("");
}

function todayDayIndex() {
  const now = Date.now();
  const diff = now - START_DATE_MS;
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

function getWordForDayIndex(index) {
  if (!allWords || allWords.length === 0) return null;
  return allWords[index % allWords.length];
}

async function loadMapping() {
  try {
    const response = await fetch("brlunicode-mapping.json");
    const data = await response.json();
    asciiToDots = data.asciiToDots || {};
    dotsToAscii = data.dotsToAscii || {};
  } catch (e) {
    mobileLog("Error loading brlunicode-mapping.json: " + e.message);
  }
}

async function loadDailyWords() {
  try {
    const response = await fetch("daily-word2.json");
    allWords = await response.json();
  } catch (e) {
    mobileLog("Error loading daily-word2.json: " + e.message);
  }
}

function updateGuessLabel() {
  const label = document.getElementById("guess-label");
  if (label) {
    label.textContent = `Guess ${currentGuess + 1} of ${MAX_GUESSES}:`;
  }
}

function lockControls() {
  const input = document.getElementById("guess-input");
  const button = document.getElementById("submit-btn");
  if (input) input.disabled = true;
  if (button) button.disabled = true;
}

function showPostGameSuggestForm() {
  const formArea = document.getElementById("suggest-form-container");
  if (formArea) {
    formArea.removeAttribute("hidden");
  }
}

function evaluateAndRenderGuess(guessAsUnicode, isRestoring = false) {
  if (!WORD_OF_THE_DAY || !WORD_OF_THE_DAY.brlunicode) return;

  const targetUnicode = WORD_OF_THE_DAY.brlunicode;
  const guessBitmasks = unicodeStringToBitmasks(guessAsUnicode);
  const targetBitmasks = unicodeStringToBitmasks(targetUnicode);

  currentGuess++;

  const rowId = `guess-row-${currentGuess}`;
  const rowNode = document.getElementById(rowId);

  let isMatch = true;

  for (let i = 0; i < 5; i++) {
    const gMask = parseInt(guessBitmasks[i] || "00000000", 2);
    const tMask = parseInt(targetBitmasks[i] || "00000000", 2);

    const correctMask = gMask & tMask;
    const wrongMask = gMask & ~tMask;

    correctDots[i] |= correctMask;
    wrongDots[i] |= wrongMask;

    if (gMask !== tMask) {
      isMatch = false;
    }

    if (rowNode && rowNode.children[i]) {
      const cellNode = rowNode.children[i];
      cellNode.textContent = guessAsUnicode[i] || "⠀";

      if (gMask === tMask) {
        cellNode.classList.add("exact-match");
      } else if (correctMask > 0) {
        cellNode.classList.add("partial-match");
      } else {
        cellNode.classList.add("no-match");
      }
    }
  }

  if (isMatch) {
    gameOver = true;
    updateNarrativeStatus(guessAsUnicode, targetUnicode, currentGuess, true, false, isRestoring);
    showPostGameSuggestForm();
    if (!isRestoring) lockControls();
  } else if (currentGuess >= MAX_GUESSES) {
    gameOver = true;
    updateNarrativeStatus(guessAsUnicode, targetUnicode, currentGuess, false, true, isRestoring);
    showPostGameSuggestForm();
    if (!isRestoring) lockControls();
  } else {
    updateNarrativeStatus(guessAsUnicode, targetUnicode, currentGuess, false, false, isRestoring);
  }

  if (!isRestoring) {
    saveGameState();
  }
}

function submitGuess() {
  if (gameOver) return;

  const input = document.getElementById("guess-input");
  if (!input) return;

  const rawVal = input.value.trim();
  if (!rawVal) return;

  evaluateAndRenderGuess(rawVal, false);

  input.value = "";
  updateGuessLabel();
}

function saveGameState() {
  const state = {
    dayIndex: todayDayIndex(),
    currentGuess,
    gameOver,
    correctDots,
    wrongDots
  };
  localStorage.setItem("contractable_game_state", JSON.stringify(state));
}

function restoreGameState() {
  const saved = localStorage.getItem("contractable_game_state");
  if (!saved) return;

  try {
    const state = JSON.parse(saved);
    if (state.dayIndex !== todayDayIndex()) {
      localStorage.removeItem("contractable_game_state");
      return;
    }
  } catch (e) {
    mobileLog("Error restoring game state: " + e.message);
  }
}

async function init() {
  await Promise.all([loadMapping(), loadDailyWords()]);

  if (allWords.length > 0) {
    WORD_OF_THE_DAY = getWordForDayIndex(todayDayIndex());
    const debugLog = document.getElementById("debug-log");
    if (debugLog) debugLog.textContent = "";
  } else {
    mobileLog("Critical: No words loaded. Check JSON files.");
  }

  restoreGameState();

  const input = document.getElementById("guess-input");
  const button = document.getElementById("submit-btn");

  if (button) button.addEventListener("click", submitGuess);
  if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submitGuess();
      }
    });
  }

  updateGuessLabel();
  if (input && !gameOver) input.focus();
}

init().catch(e => mobileLog("Init Error: " + e.message));
