"use strict";

const MAX_GUESSES = 6;
const START_DATE_MS = 1774396800000; // Day 0 = 2026-03-25
const STORAGE_KEY = "contractable_game_state";

const FORMSPREE_ENDPOINT = "https://formspree.io/f/mwvdgkyj";

let WORD_OF_THE_DAY = null; // Stored as a complete object: { id, print, brlunicode }
let allWords = [];          // Array of objects from daily-word4.json
let asciiToDots = {};       // Maps both Computer Braille ASCII and Unicode Braille to 8-bit binary strings
let dotsToAscii = {};       // Maps 8-bit binary strings to literal Unicode Braille characters
let currentGuess = 0;
let gameOver = false;

// Persistent metric tracking targets across rounds (Cumulative)
let correctDots = [];
let wrongDots = [];   // Cumulative union of "wrong" (guessed-but-not-in-target) dots across all guesses this game

// End game custom Braille Unicode messaging
const WIN_STATUS_MESSAGE = "⠠⠠⠽⠀⠠⠠⠺⠔⠖⠀⠀";
const LOSE_STATUS_MESSAGE = "⠀⠠⠎⠕⠗⠗⠽⠂⠀⠛⠁⠍⠑⠀⠕⠧⠻⠲⠀";

// Braille "blank cell" character — treated as a word separator alongside regular whitespace,
// since suggested words may be entered as raw Unicode Braille rather than print letters.
const BRAILLE_BLANK = "\u2800";

// Optimized 1-cell lower-sign prefixes (Numbers 1-6 dropped to bottom pins) for 20-cell display limits
const ROW_NUMERIC_PREFIXES = ["⠂", "⠆", "⠒", "⠲", "⠢", "⠖"];

// Helper to log errors directly to the screen on iPhone
function mobileLog(msg) {
  const log = document.getElementById("debug-log");
  if (log) log.textContent += msg + "\n";
  console.error(msg);
}

/* ── PRNG & Logic ─────────────────────────────────────────────────────────[...]

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
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function applyFirstCharConstraint(arr, prevLastChar = null) {
  const a = arr.slice();
  if (prevLastChar !== null && a[0].print[0] === prevLastChar) {
    for (let j = 1; j < a.length; j++) {
      if (a[j].print[0] !== prevLastChar) {
        [a[0], a[j]] = [a[j], a[0]];
        break;
      }
    }
  }
  for (let i = 1; i < a.length; i++) {
    if (a[i].print[0] === a[i - 1].print[0]) {
      for (let j = i + 1; j < a.length; j++) {
        if (a[j].print[0] !== a[i - 1].print[0]) {
          [a[i], a[j]] = [a[j], a[i]];
          break;
        }
      }
    }
  }
  return a;
}

function buildCycle(cycleIndex, prevLastChar = null) {
  const seed = (START_DATE_MS + cycleIndex) >>> 0;
  const shuffled = deterministicShuffle(allWords, seed);
  return applyFirstCharConstraint(shuffled, prevLastChar);
}

function getWordForDayIndex(dayIndex) {
  const listSize = allWords.length || 1; 
  const cycleIndex = Math.floor(dayIndex / listSize);
  const position = dayIndex % listSize;
  let prevLastChar = null;
  if (cycleIndex > 0) {
    const prevCycle = buildCycle(cycleIndex - 1, null);
    prevLastChar = prevCycle[prevCycle.length - 1].print[0];
  }
  const cycle = buildCycle(cycleIndex, prevLastChar);
  return cycle[position];
}

function todayDayIndex() {
  const nowUTC = Date.now();
  return Math.floor((nowUTC - START_DATE_MS) / 86400000);
}

/* ── Loaders ───────────────────────────────────────────────────────────[...]

async function loadDailyWords() {
  try {
    const response = await fetch("daily-word4.json");
    if (!response.ok) throw new Error("Could not find daily-word4.json");
    allWords = await response.json();
  } catch (e) {
    mobileLog("Daily Words Error: " + e.message);
  }
}

async function loadMapping() {
  try {
    const response = await fetch("brlunicode-mapping.json");
    if (!response.ok) throw new Error("Could not find brlunicode-mapping.json");
    const data = await response.json();
    
    asciiToDots = {};
    dotsToAscii = {};
    
    data.forEach(item => {
      const fullBitmask = item.bitmask;
      
      if (item.printAscii) {
        asciiToDots[item.printAscii] = fullBitmask;
      }
      if (item.unicodeChar) {
        asciiToDots[item.unicodeChar] = fullBitmask;
      }
      
      dotsToAscii[fullBitmask] = item.unicodeChar || "\u2800";
    });
  } catch (e) {
    mobileLog("Mapping Error: " + e.message);
  }
}

/* ── State Persistence Management ─────────────────────────────────────────── */

function saveGameState(rawGuessesArray) {
  const state = {
    dayIndex: todayDayIndex(),
    guesses: rawGuessesArray,
    gameOver: gameOver
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadAndRestoreGameState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return;

  try {
    const state = JSON.parse(saved);
    const currentDay = todayDayIndex();

    // If the saved data matches today's game profile, reconstruct the state
    if (state && state.dayIndex === currentDay) {
      const input = document.getElementById("guess-input");
      
      // Programmatically process prior inputs to rebuild the interface metrics natively
      if (Array.isArray(state.guesses)) {
        state.guesses.forEach(guessValue => {
          evaluateAndRenderGuess(guessValue, true);
        });
      }
      
      // If the recovered session profile marked the game finished, engage locking
      if (state.gameOver) {
        gameOver = true;
        lockControls();
        revealPostGameSuggestForm();
      }
    } else {
      // Stale data from previous days is wiped cleanly
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch (e) {
    mobileLog("State Restoration Error: " + e.message);
  }
}

function lockControls() {
  const input = document.getElementById("guess-input");
  const button = document.getElementById("submit-btn");
  if (input) input.disabled = true;
  if (button) button.disabled = true;
}

function getStoredGuesses() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return [];
  try {
    const state = JSON.parse(saved);
    if (state && state.dayIndex === todayDayIndex() && Array.isArray(state.guesses)) {
      return state.guesses;
    }
  } catch(e) {}
  return [];
}

/* ── UI & Game Logic ─────────────────────────────────────────────────────── */

function setStatus(msg) {
  const status = document.getElementById("status");
  status.textContent = msg;
  status.removeAttribute("hidden"); 
  setTimeout(() => { status.focus(); }, 0); 
}

// Renders "Not in word list." plus an inline "Should it be? Click to suggest."
// button that fires a background suggestion for the exact guess the player typed.
function setStatusWithSuggestLink(word) {
  const status = document.getElementById("status");
  status.textContent = "";

  status.appendChild(document.createTextNode("Not in word list. "));

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "suggest-link-btn";
  btn.textContent = "Should it be? Click to suggest.";
  btn.addEventListener("click", () => submitSingleWordSuggestion(word, btn));

  status.appendChild(btn);
  status.removeAttribute("hidden");
  setTimeout(() => { status.focus(); }, 0);
}

function revealPostGameSuggestForm() {
  const section = document.getElementById("post-game-suggest");
  if (section) section.hidden = false;
}

function updateGuessLabel() {
  const label = document.getElementById("guess-label");
  label.textContent = (currentGuess === MAX_GUESSES - 1) ? "f9al guess" : "guess";
}

function dotsArrayToAsciiString(arr) {
  return arr.map(d => dotsToAscii[d] ?? "\u2800").join("");
}

function formatRow({ guessIndex, correct, guess, wrong }) {
  const label = guessIndex < 6 ? ROW_NUMERIC_PREFIXES[guessIndex] : "";
  return `${label}\u2800${correct}\u2800${guess}\u2800${wrong}`;
}

function renderRow(rowText) {
  const board = document.getElementById("game-board");
  const row = document.createElement("div");
  row.className = "row";
  row.tabIndex = -1;
  
  row.setAttribute("aria-braillelabel", rowText);
  row.setAttribute("aria-label", `Row ${currentGuess + 1}`);

  const visualWrapper = document.createElement("span");
  visualWrapper.setAttribute("aria-hidden", "true");
  visualWrapper.textContent = rowText;
  
  row.appendChild(visualWrapper);
  board.appendChild(row);
  row.focus();
}

// A guess qualifies for the one-click "should it be?" suggestion only if it's a clean
// standalone token: 5+ characters, and containing no regular whitespace or braille blanks
// (which would mean the player typed something other than a single word).
function isValidSingleSuggestion(rawGuess) {
  if (!rawGuess) return false;
  if (rawGuess.length < 5) return false;
  if (/\s/.test(rawGuess)) return false;
  if (rawGuess.indexOf(BRAILLE_BLANK) !== -1) return false;
  return true;
}

// Split raw textarea content into candidate words on either regular whitespace
// or braille blank cells, since suggestions may be typed as print letters or
// as raw Unicode Braille.
function parseSuggestionWords(raw) {
  return raw
    .split(/[\s\u2800]+/)
    .map(w => w.trim())
    .filter(w => w.length > 0);
}

function validateSuggestions(raw) {
  const words = parseSuggestionWords(raw);
  const valid = [];
  const skipped = [];
  words.forEach(w => {
    if (w.length >= 5) {
      valid.push(w);
    } else {
      skipped.push(w);
    }
  });
  return { valid, skipped };
}

async function postSuggestion(payload) {
  const response = await fetch(FORMSPREE_ENDPOINT, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  return response.ok;
}

async function submitSingleWordSuggestion(word, btnEl) {
  btnEl.disabled = true;
  btnEl.textContent = "Sending...";

  try {
    const ok = await postSuggestion({ word: word, source: "single-click-suggest" });
    btnEl.textContent = ok ? "Thanks, suggestion sent!" : "Couldn't send \u2014 try later.";
    if (!ok) btnEl.disabled = false;
  } catch (e) {
    btnEl.textContent = "Couldn't send \u2014 try later.";
    btnEl.disabled = false;
  }
}

async function submitPostGameSuggestions() {
  const textarea = document.getElementById("suggest-input");
  const feedback = document.getElementById("suggest-feedback");
  const btn = document.getElementById("suggest-submit-btn");

  const { valid, skipped } = validateSuggestions(textarea.value);

  if (valid.length === 0) {
    feedback.textContent = skipped.length
      ? `All ${skipped.length} word(s) were too short (need 5+ characters). Nothing sent.`
      : "Enter at least one word first.";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Sending...";

  try {
    const ok = await postSuggestion({ words: valid.join(", "), source: "post-game-form" });

    if (ok) {
      let msg = `Sent ${valid.length} word${valid.length === 1 ? "" : "s"}.`;
      if (skipped.length > 0) {
        msg += ` Skipped ${skipped.length} (too short): ${skipped.join(", ")}.`;
      }
      feedback.textContent = msg;
      textarea.value = "";
    } else {
      feedback.textContent = "Couldn't send suggestions \u2014 try again later.";
    }
  } catch (e) {
    feedback.textContent = "Couldn't send suggestions \u2014 try again later.";
  } finally {
    btn.disabled = false;
    btn.textContent = "Send suggestions";
  }
}

// Split out core processing logic so page reloader can pass values silently
function evaluateAndRenderGuess(rawGuess, isRestoring = false) {
  let matchedWord = null;
  let guessAsUnicode = "";

  const isStandardPrint = /^[A-Za-z0-9]+$/.test(rawGuess);

  if (isStandardPrint) {
    const lowerGuess = rawGuess.toLowerCase();
    matchedWord = allWords.find(word => word.print.toLowerCase() === lowerGuess);
    if (matchedWord) {
      guessAsUnicode = matchedWord.brlunicode;
    }
  } else {
    const guessDots = [];
    for (const ch of rawGuess) {
      guessDots.push(asciiToDots[ch] || "00000000"); 
    }
    guessAsUnicode = dotsArrayToAsciiString(guessDots);
    matchedWord = allWords.find(word => word.brlunicode === guessAsUnicode);
  }

  if (!matchedWord) {
    if (!isRestoring) {
      if (isValidSingleSuggestion(rawGuess)) {
        setStatusWithSuggestLink(rawGuess);
      } else {
        setStatus("Not in word list.");
      }
    }
    return false;
  }

  const targetUnicode = WORD_OF_THE_DAY.brlunicode;
  const targetDots = [];
  for (const ch of targetUnicode) {
    targetDots.push(asciiToDots[ch] || "00000000");
  }

  const guessDotsArray = [];
  for (const ch of guessAsUnicode) {
    guessDotsArray.push(asciiToDots[ch] || "00000000");
  }

  if (correctDots.length !== targetDots.length) {
    correctDots = Array(targetDots.length).fill(0);
    wrongDots = Array(targetDots.length).fill(0);
  }

  const rowCorrectStrings = [];
  const rowWrongStrings = [];

  for (let i = 0; i < targetDots.length; i++) {
    const g = parseInt(guessDotsArray[i] || "00000000", 2);
    const t = parseInt(targetDots[i], 2);

    correctDots[i] |= (g & t);
    wrongDots[i] |= (g & ~t);

    rowCorrectStrings.push(correctDots[i].toString(2).padStart(8, "0"));
    rowWrongStrings.push(wrongDots[i].toString(2).padStart(8, "0"));
  }

  renderRow(formatRow({
    guessIndex: currentGuess,
    correct: dotsArrayToAsciiString(rowCorrectStrings),
    guess: guessAsUnicode,
    wrong: dotsArrayToAsciiString(rowWrongStrings),
  }));

  currentGuess++;
  updateGuessLabel();

  const isMatch = (matchedWord.print.toLowerCase() === WORD_OF_THE_DAY.print.toLowerCase());

  if (isMatch) {
    setStatus(WIN_STATUS_MESSAGE);
    gameOver = true;
    if (!isRestoring) lockControls();
    revealPostGameSuggestForm();
  } else if (currentGuess >= MAX_GUESSES) {
    setStatus(LOSE_STATUS_MESSAGE);
    gameOver = true;
    if (!isRestoring) lockControls();
    revealPostGameSuggestForm();
  }

  return true;
}

function submitGuess() {
  if (gameOver || !WORD_OF_THE_DAY) return;

  const input = document.getElementById("guess-input");
  const rawGuess = input.value.trim();
  if (!rawGuess) return;

  if (!gameOver) {
    const statusDiv = document.getElementById("status");
    statusDiv.setAttribute("hidden", "");
    statusDiv.textContent = "";
  }

  // Evaluate the validation track
  const success = evaluateAndRenderGuess(rawGuess, false);

  if (success) {
    // Commit the new entry to permanent storage records
    const historicalGuesses = getStoredGuesses();
    historicalGuesses.push(rawGuess);
    saveGameState(historicalGuesses);
    
    input.value = "";
  }
}

async function init() {
  await Promise.all([loadMapping(), loadDailyWords()]);

  if (allWords.length > 0) {
    WORD_OF_THE_DAY = getWordForDayIndex(todayDayIndex());
    const debugLog = document.getElementById("debug-log");
    if (debugLog) debugLog.textContent = ""; 
    
    // Core game state loading cycle runs immediately when dictionary data arrives
    loadAndRestoreGameState();
  } else {
    mobileLog("Critical: No words loaded. Check JSON files.");
  }

  const input = document.getElementById("guess-input");
  const button = document.getElementById("submit-btn");
  const suggestBtn = document.getElementById("suggest-submit-btn");

  button.addEventListener("click", submitGuess);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitGuess();
    }
  });

  if (suggestBtn) {
    suggestBtn.addEventListener("click", submitPostGameSuggestions);
  }

  updateGuessLabel();
  if (!gameOver) {
    input.focus();
  }
}

init().catch(e => mobileLog("Init Error: " + e.message));
