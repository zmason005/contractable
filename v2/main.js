"use strict";

const MAX_GUESSES = 6;
const START_DATE_MS = 1774396800000; // Day 0 = 2026-03-25
const STORAGE_KEY = "contractable_game_state";
const SUGGEST_FORMSPREE_URL = "https://formspree.io/f/mwvdgkyj";
const SUGGEST_MIN_WORD_LENGTH = 5;

// liblouis-backed verification: confirms a suggested word actually
// translates to exactly 5 Grade 2 UEB braille cells before it's sent.
const LOUIS_WORKER_URL = "louis-worker.js";
const LOUIS_TARGET_CELL_COUNT = 5;

let WORD_OF_THE_DAY = null; // Stored as a complete object: { id, print, brlunicode }
let allWords = [];          // Array of objects from daily-word4.json
let asciiToDots = {};       // Maps both Computer Braille ASCII and Unicode Braille to 8-bit binary strings
let dotsToAscii = {};       // Maps 8-bit binary strings to literal Unicode Braille characters
let currentGuess = 0;
let gameOver = false;
let activeDayIndex = null; // The day index the currently-loaded game state belongs to

// Persistent metric tracking targets across rounds (Cumulative)
let correctDots = [];
let wrongDots = [];   // Cumulative union of "wrong" (guessed-but-not-in-target) dots across all guesses this game

/* ── Six-key entry mode state ────────────────────────────────────────────── */

const INPUT_MODE_KEY = "contractable_input_mode";
let inputMode = "standard"; // "standard" | "sixkey"

// 5 cells x 6 booleans. Index 0 = dot 1 ... index 5 = dot 6.
let sixKeyCells = Array.from({ length: 5 }, () => [false, false, false, false, false, false]);
let currentCellIndex = 0;
let currentCellHighlightVisible = true;

// Bitmask string position -> dot number, matching brlunicode-mapping.json's
// convention (verified against the data: bit index 0 = dot 7, 1 = dot 3,
// 2 = dot 2, 3 = dot 1, 4 = dot 4, 5 = dot 5, 6 = dot 6, 7 = dot 8).
const BITMASK_DOT_ORDER = [7, 3, 2, 1, 4, 5, 6, 8];

// Standard Perkins-style chord keys: S D F (dots 3,2,1) / J K L (dots 4,5,6)
const CHORD_KEY_TO_DOT = { s: 3, d: 2, f: 1, j: 4, k: 5, l: 6 };

let chordKeysHeld = new Set();   // keys currently physically held down
let chordDotsPressed = new Set(); // dot numbers touched at any point during this chord gesture

// End game custom Braille Unicode messaging
const WIN_STATUS_MESSAGE = "⠠⠠⠽⠀⠠⠠⠺⠔⠖⠀⠀";
const LOSE_STATUS_MESSAGE = "⠀⠠⠎⠕⠗⠗⠽⠂⠀⠛⠁⠍⠑⠀⠕⠧⠻⠲⠀";

// Optimized 1-cell lower-sign prefixes (Numbers 1-6 dropped to bottom pins) for 20-cell display limits
const ROW_NUMERIC_PREFIXES = ["⠂", "⠆", "⠒", "⠲", "⠢", "⠖"];

// Helper to log errors directly to the screen on iPhone
function mobileLog(msg) {
  const log = document.getElementById("debug-log");
  if (log) log.textContent += msg + "\n";
  console.error(msg);
}

/* ── PRNG & Logic ────────────────────────────────────────────────────────── */

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

// Returns a stable integer "calendar day number" based on the PLAYER'S LOCAL date
// (year/month/day), not raw UTC milliseconds. Using Date.UTC() on the local Y/M/D
// components (rather than dividing Date.now() by 86400000) avoids drift around
// DST transitions and ensures the boundary is local midnight, not UTC midnight.
function localCalendarDayNumber() {
  const now = new Date();
  return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000);
}

// Day 0 anchor expressed as the same kind of calendar day number, so subtracting
// the two always yields a whole number of local calendar days.
const START_DAY_NUMBER = Math.floor(START_DATE_MS / 86400000);

function todayDayIndex() {
  return localCalendarDayNumber() - START_DAY_NUMBER;
}

/* ── Loaders ──────────────────────────────────────────────────────────────── */

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

/* ── Six-Key Entry Mode ───────────────────────────────────────────────────── */

function loadInputModePreference() {
  const saved = localStorage.getItem(INPUT_MODE_KEY);
  inputMode = (saved === "sixkey") ? "sixkey" : "standard";
}

function saveInputModePreference() {
  localStorage.setItem(INPUT_MODE_KEY, inputMode);
}

function applyInputMode() {
  const standardControls = document.getElementById("controls");
  const sixkeyControls = document.getElementById("sixkey-controls");
  const toggleBtn = document.getElementById("mode-toggle-btn");

  if (inputMode === "sixkey") {
    if (standardControls) standardControls.hidden = true;
    if (sixkeyControls) sixkeyControls.hidden = false;
    if (toggleBtn) {
      toggleBtn.textContent = "Switch to standard input";
      toggleBtn.setAttribute("aria-label", "Switch to standard text input");
    }
    renderSixKeyCells();
    if (!gameOver) {
      const cellsEl = document.getElementById("sixkey-cells");
      if (cellsEl) cellsEl.focus();
    }
  } else {
    if (sixkeyControls) sixkeyControls.hidden = true;
    if (standardControls) standardControls.hidden = false;
    if (toggleBtn) {
      toggleBtn.textContent = "Switch to 6-key entry";
      toggleBtn.setAttribute("aria-label", "Switch to six-key braille entry");
    }
    if (!gameOver) {
      const input = document.getElementById("guess-input");
      if (input) input.focus();
    }
  }
}

function toggleInputMode() {
  inputMode = (inputMode === "sixkey") ? "standard" : "sixkey";
  saveInputModePreference();
  applyInputMode();
}

function announceSixKey(msg) {
  const live = document.getElementById("sixkey-live");
  if (live) live.textContent = msg;
}

function renderSixKeyCells(livePreview = false) {
  const cellEls = document.querySelectorAll("#sixkey-cells .cell");
  cellEls.forEach(cellEl => {
    const idx = parseInt(cellEl.dataset.cell, 10);
    const isCurrent = idx === currentCellIndex && currentCellHighlightVisible;
    cellEl.classList.toggle("current-cell", isCurrent);

    const dotEls = cellEl.querySelectorAll(".dot");
    dotEls.forEach(dotEl => {
      const dotNum = parseInt(dotEl.dataset.dot, 10);
      const committed = sixKeyCells[idx][dotNum - 1];
      const preview = livePreview && idx === currentCellIndex && chordDotsPressed.has(dotNum);
      dotEl.classList.toggle("on", committed || preview);
    });
  });
}

function moveCurrentCell(direction) {
  currentCellIndex = Math.min(4, Math.max(0, currentCellIndex + direction));
  currentCellHighlightVisible = true;
  renderSixKeyCells();
  announceSixKey("Cell " + (currentCellIndex + 1) + " of 5.");
}

function clearCurrentCell() {
  sixKeyCells[currentCellIndex] = [false, false, false, false, false, false];
  renderSixKeyCells();
  announceSixKey("Cell " + (currentCellIndex + 1) + " cleared.");
}

function clearAllSixKey() {
  sixKeyCells = Array.from({ length: 5 }, () => [false, false, false, false, false, false]);
  currentCellIndex = 0;
  currentCellHighlightVisible = true;
  chordKeysHeld = new Set();
  chordDotsPressed = new Set();
  renderSixKeyCells();
}

// Converts a single cell's boolean dot array into the same kind of 8-bit
// bitmask string used throughout brlunicode-mapping.json, so it can be
// looked up in dotsToAscii exactly like any other cell.
function sixKeyCellToBitmaskString(cellDotsOnArray) {
  const onDots = new Set();
  for (let i = 0; i < 6; i++) {
    if (cellDotsOnArray[i]) onDots.add(i + 1);
  }
  let bits = "";
  for (let i = 0; i < 8; i++) {
    bits += onDots.has(BITMASK_DOT_ORDER[i]) ? "1" : "0";
  }
  return bits;
}

function sixKeyCellsToUnicodeGuess() {
  return sixKeyCells
    .map(cell => dotsToAscii[sixKeyCellToBitmaskString(cell)] ?? "\u2800")
    .join("");
}

function handleSixKeyDotClick(e) {
  if (gameOver) return;
  const dotEl = e.target.closest(".dot");
  if (!dotEl) return;

  const cellIndex = parseInt(dotEl.dataset.cell, 10);
  const dotNum = parseInt(dotEl.dataset.dot, 10);

  sixKeyCells[cellIndex][dotNum - 1] = !sixKeyCells[cellIndex][dotNum - 1];
  currentCellIndex = cellIndex;
  // Manual tapping takes over from the keyboard-driven "current cell" flow,
  // so the highlight steps back until a chord key is pressed again.
  currentCellHighlightVisible = false;
  renderSixKeyCells();
}

function handleSixKeyKeydown(e) {
  if (gameOver) return;
  const key = e.key.toLowerCase();

  if (Object.prototype.hasOwnProperty.call(CHORD_KEY_TO_DOT, key)) {
    e.preventDefault();
    if (!chordKeysHeld.has(key)) {
      chordKeysHeld.add(key);
      chordDotsPressed.add(CHORD_KEY_TO_DOT[key]);
      currentCellHighlightVisible = true;
      renderSixKeyCells(true);
    }
    return;
  }

  if (key === "arrowleft") {
    e.preventDefault();
    moveCurrentCell(-1);
  } else if (key === "arrowright") {
    e.preventDefault();
    moveCurrentCell(1);
  } else if (key === "tab") {
    e.preventDefault();
    moveCurrentCell(e.shiftKey ? -1 : 1);
  } else if (key === "backspace") {
    e.preventDefault();
    clearCurrentCell();
  } else if (key === "enter") {
    e.preventDefault();
    submitSixKeyGuess();
  }
}

function handleSixKeyKeyup(e) {
  const key = e.key.toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(CHORD_KEY_TO_DOT, key)) return;

  chordKeysHeld.delete(key);

  if (chordKeysHeld.size === 0 && chordDotsPressed.size > 0) {
    // All chord keys released: commit the combined dot pattern as the
    // current cell's new value (replaces, rather than merges with, any
    // prior state in that cell) and auto-advance.
    const newCell = [false, false, false, false, false, false];
    chordDotsPressed.forEach(dotNum => { newCell[dotNum - 1] = true; });
    sixKeyCells[currentCellIndex] = newCell;
    chordDotsPressed = new Set();

    announceSixKey("Cell " + (currentCellIndex + 1) + " set.");
    moveCurrentCell(currentCellIndex < 4 ? 1 : 0);
    renderSixKeyCells();
  } else {
    renderSixKeyCells(true);
  }
}

function submitSixKeyGuess() {
  if (gameOver) return;
  const rawGuess = sixKeyCellsToUnicodeGuess();
  const success = submitRawGuess(rawGuess);
  if (success) {
    clearAllSixKey();
  }
}

/* ── Post-Game Word Suggestions ───────────────────────────────────────────── */

// Lazily-created worker (see louis-worker.js) that translates candidate
// suggestion words into Grade 2 UEB via liblouis, off the main thread.
let louisWorker = null;
let louisRequestId = 0;
const louisPending = new Map();

function getLouisWorker() {
  if (louisWorker) return louisWorker;
  try {
    louisWorker = new Worker(LOUIS_WORKER_URL);
    louisWorker.onmessage = (evt) => {
      const data = evt.data || {};
      const pending = louisPending.get(data.id);
      if (!pending) return;
      louisPending.delete(data.id);
      if (data.ok) pending.resolve(data.results);
      else pending.reject(new Error(data.error || "liblouis translation failed"));
    };
    louisWorker.onerror = (evt) => {
      // The worker itself failed to load/run (e.g. CDN blocked). Reject
      // every in-flight request so callers can fall back gracefully.
      const message = "liblouis worker error: " + (evt && evt.message ? evt.message : "unknown");
      for (const pending of louisPending.values()) {
        pending.reject(new Error(message));
      }
      louisPending.clear();
    };
  } catch (e) {
    mobileLog("Louis Worker Init Error: " + e.message);
    louisWorker = null;
  }
  return louisWorker;
}

// Resolves to an array of { word, brl, cellCount } for each input word.
function translateWordsWithLiblouis(words) {
  return new Promise((resolve, reject) => {
    const worker = getLouisWorker();
    if (!worker) {
      reject(new Error("liblouis worker unavailable"));
      return;
    }
    const id = ++louisRequestId;
    louisPending.set(id, { resolve, reject });
    worker.postMessage({ id, words });
  });
}

function showPostGameSuggestForm() {
  const suggestSection = document.getElementById("post-game-suggest");
  if (suggestSection) suggestSection.hidden = false;
  // Warm up the liblouis worker now so translation is ready by the time
  // the player finishes typing and hits submit.
  getLouisWorker();
}

function hidePostGameSuggestForm() {
  const suggestSection = document.getElementById("post-game-suggest");
  const input = document.getElementById("suggest-input");
  const feedback = document.getElementById("suggest-feedback");
  if (suggestSection) suggestSection.hidden = true;
  if (input) input.value = "";
  if (feedback) {
    feedback.textContent = "";
    feedback.classList.remove("error");
  }
}

function setSuggestFeedback(msg, isError = false) {
  const feedback = document.getElementById("suggest-feedback");
  if (!feedback) return;
  feedback.textContent = msg;
  feedback.classList.toggle("error", !!isError);
}

// Splits the textarea contents on whitespace/line breaks and keeps only
// candidates that look like plausible words: letters only, 5+ characters.
// Returns a de-duplicated array of lowercase words.
function parseSuggestedWords(rawText) {
  const candidates = rawText.split(/[\s,]+/).map(w => w.trim()).filter(Boolean);
  const seen = new Set();
  const valid = [];
  for (const word of candidates) {
    const lower = word.toLowerCase();
    if (!/^[a-z]+$/.test(lower)) continue;
    if (lower.length < SUGGEST_MIN_WORD_LENGTH) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    valid.push(lower);
  }
  return valid;
}

async function submitWordSuggestions() {
  const input = document.getElementById("suggest-input");
  const submitBtn = document.getElementById("suggest-submit-btn");
  if (!input) return;

  const candidateWords = parseSuggestedWords(input.value);
  if (candidateWords.length === 0) {
    setSuggestFeedback("Enter at least one word, letters only, 5 or more characters.", true);
    return;
  }

  if (submitBtn) submitBtn.disabled = true;
  setSuggestFeedback("Checking braille cell count\u2026");

  // parseSuggestedWords only filters on print-word length, which is just a
  // cheap pre-filter — Grade 2 UEB contractions mean print length doesn't
  // reliably predict braille cell count. Run every candidate through
  // liblouis and only keep the ones that translate to exactly 5 cells.
  let passedWords = candidateWords;
  let louisResults = null;
  let louisVerified = false;
  let errorMessage = "";

  try {
    louisResults = await translateWordsWithLiblouis(candidateWords);
    louisVerified = true;

    const rejectedWords = louisResults.filter(r => r.cellCount !== LOUIS_TARGET_CELL_COUNT);
    passedWords = louisResults
      .filter(r => r.cellCount === LOUIS_TARGET_CELL_COUNT)
      .map(r => r.word);

    if (rejectedWords.length > 0) {
      // List only the failing words, alongside their actual braille translation,
      // so the player can see exactly why each one didn't qualify.
      const listing = rejectedWords
        .map(r => `${r.word} (${r.brl && r.brl.length ? r.brl : "\u2800"})`)
        .join(", ");
      errorMessage = `Not 5 braille cells, not sent: ${listing}.`;
    }

    if (passedWords.length === 0) {
      setSuggestFeedback(errorMessage, true);
      if (submitBtn) submitBtn.disabled = false;
      return;
    }
  } catch (e) {
    // liblouis couldn't load (e.g. the CDN is unreachable) — don't block
    // the suggestion entirely, just send unverified and flag it as such.
    mobileLog("Liblouis Verify Error: " + e.message);
    louisVerified = false;
    setSuggestFeedback("Braille check unavailable — sending unverified\u2026");
  }

  // Formspree requires FormData (not a JSON body) or the request is blocked
  // by a CORS preflight failure before it ever reaches the endpoint.
  const formData = new FormData();
  formData.append("words", passedWords.join(" "));
  formData.append("wordCount", String(passedWords.length));
  formData.append("source", "contractable v2 six-key/standard board");
  formData.append("louisVerified", String(louisVerified));
  if (louisVerified && louisResults) {
    formData.append("brailleCellCounts", louisResults.map(r => `${r.word}:${r.cellCount}`).join(","));
  }
  if (WORD_OF_THE_DAY) formData.append("todaysWord", WORD_OF_THE_DAY.print);

  try {
    const response = await fetch(SUGGEST_FORMSPREE_URL, {
      method: "POST",
      body: formData,
      headers: { "Accept": "application/json" }
    });

    if (response.ok) {
      const sentMessage = passedWords.length === 1
        ? "Thanks! Your word suggestion was sent."
        : `Thanks! ${passedWords.length} word suggestions were sent.`;
      setSuggestFeedback(
        errorMessage ? `${errorMessage} ${sentMessage}` : sentMessage,
        Boolean(errorMessage)
      );
      input.value = "";
    } else {
      const failMessage = "Something went wrong sending that. Please try again.";
      setSuggestFeedback(errorMessage ? `${errorMessage} ${failMessage}` : failMessage, true);
    }
  } catch (e) {
    const netMessage = "Network error — please try again.";
    setSuggestFeedback(errorMessage ? `${errorMessage} ${netMessage}` : netMessage, true);
    mobileLog("Suggestion Submit Error: " + e.message);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
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
  const sixkeySubmit = document.getElementById("sixkey-submit-btn");
  const sixkeyClear = document.getElementById("sixkey-clear-btn");
  const sixkeyCells = document.getElementById("sixkey-cells");
  if (input) input.disabled = true;
  if (button) button.disabled = true;
  if (sixkeySubmit) sixkeySubmit.disabled = true;
  if (sixkeyClear) sixkeyClear.disabled = true;
  if (sixkeyCells) sixkeyCells.setAttribute("aria-disabled", "true");
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

// Detects whether the local calendar day has advanced since the game was loaded
// (e.g. a browser tab left open past local midnight on mobile Safari) and, if so,
// fully resets in-memory and persisted state for the new day's word. Safe to call
// often — it's a no-op unless the day has actually changed.
function checkForNewDay() {
  const nowDayIndex = todayDayIndex();
  if (activeDayIndex !== null && nowDayIndex !== activeDayIndex) {
    resetGameForNewDay(nowDayIndex);
    return true;
  }
  return false;
}

function resetGameForNewDay(nowDayIndex) {
  // Wipe any stale state left over from the previous day
  localStorage.removeItem(STORAGE_KEY);

  activeDayIndex = nowDayIndex;
  WORD_OF_THE_DAY = getWordForDayIndex(nowDayIndex);

  currentGuess = 0;
  gameOver = false;
  correctDots = [];
  wrongDots = [];

  // Clear rendered guess rows (leave the header row intact)
  const board = document.getElementById("game-board");
  if (board) {
    board.querySelectorAll(".row").forEach(row => row.remove());
  }

  // Reset status area
  const status = document.getElementById("status");
  if (status) {
    status.setAttribute("hidden", "");
    status.textContent = "";
  }

  // Hide the post-game suggestion form again, clearing any typed-but-unsent input
  hidePostGameSuggestForm();

  // Re-enable controls and clear any leftover input
  const input = document.getElementById("guess-input");
  const button = document.getElementById("submit-btn");
  const sixkeySubmit = document.getElementById("sixkey-submit-btn");
  const sixkeyClear = document.getElementById("sixkey-clear-btn");
  const sixkeyCellsEl = document.getElementById("sixkey-cells");
  if (input) {
    input.disabled = false;
    input.value = "";
  }
  if (button) button.disabled = false;
  if (sixkeySubmit) sixkeySubmit.disabled = false;
  if (sixkeyClear) sixkeyClear.disabled = false;
  if (sixkeyCellsEl) sixkeyCellsEl.removeAttribute("aria-disabled");
  clearAllSixKey();

  updateGuessLabel();
  if (inputMode === "sixkey") {
    if (sixkeyCellsEl) sixkeyCellsEl.focus();
  } else if (input) {
    input.focus();
  }
}

/* ── UI & Game Logic ─────────────────────────────────────────────────────── */

function setStatus(msg) {
  const status = document.getElementById("status");
  status.textContent = msg;
  status.removeAttribute("hidden"); 
  setTimeout(() => { status.focus(); }, 0); 
}

function updateGuessLabel() {
  const label = document.getElementById("guess-label");
  label.textContent = (currentGuess === MAX_GUESSES - 1) ? "final guess" : "guess";
}

function dotsArrayToAsciiString(arr) {
  return arr.map(d => dotsToAscii[d] ?? "\u2800").join("");
}

function formatRow({ guessIndex, correct, guess, wrong }) {
  const label = guessIndex < 6 ? ROW_NUMERIC_PREFIXES[guessIndex] : "";
  return `${label}\u2800${correct}\u2800${guess}\u2800${wrong}`;
}

// Source braille strings for the two generated label contexts. These match
// (and must stay in sync with) the aria-label/aria-braillelabel attributes
// already present on #header and the h1 in index.html — those attributes
// remain the source of truth for assistive tech; these constants only drive
// the aria-hidden visual nested-span markup.
const HEADER_BRAILLE = "⠉⠕⠗⠗⠑⠉⠞⠀⠛⠥⠑⠎⠎⠀⠺⠗⠰⠛"; // "correct guess wrong"
const HEADING_BRAILLE = "⠠⠠⠒⠞⠗⠁⠉⠞⠁⠃⠇⠑";           // "CONTRACTABLE"

// Rebuilds the board header ("correct guess wrong") using the same nested
// span.cell > span.dot structure as guess rows, so the three columns line
// up under the correct/guess/wrong groups of every row below it. Unraised
// dots use the "dot-label" modifier (fully invisible) since this is a
// label, not an interactive/readable board row.
function buildHeaderCells() {
  const header = document.getElementById("header");
  if (!header) return;

  header.innerHTML = "";

  const rowLabel = document.createElement("span");
  rowLabel.className = "row-label";
  rowLabel.setAttribute("aria-hidden", "true");
  header.appendChild(rowLabel);

  const [correctWord, guessWord, wrongWord] = HEADER_BRAILLE.split("\u2800");

  header.appendChild(buildRowGroup(padOrTruncateToFiveCells(unicodeStringToBitmasks(correctWord)), "row-group-correct", "dot-label"));
  header.appendChild(buildRowGroup(padOrTruncateToFiveCells(unicodeStringToBitmasks(guessWord)), "row-group-guess", "dot-label"));
  header.appendChild(buildRowGroup(padOrTruncateToFiveCells(unicodeStringToBitmasks(wrongWord)), "row-group-wrong", "dot-label"));
}

// Every board column is sized for exactly 5 braille cells (the fixed word
// length used throughout the game). Header labels are plain English words
// ("correct", "guess", "wrong") that don't reliably translate to 5 cells
// each, so this pads short words with blank filler cells and truncates
// long ones, guaranteeing every header column matches the 5-cell width of
// the real guess rows below it instead of overflowing/wrapping.
function padOrTruncateToFiveCells(bitmaskArray) {
  const BLANK_CELL = "00000000";
  const out = bitmaskArray.slice(0, 5);
  while (out.length < 5) out.push(BLANK_CELL);
  return out;
}

// Rebuilds the "CONTRACTABLE" h1 using the same nested-span structure,
// scaled in em via #heading-cells' own CSS rather than the board's vw
// sizing. Also uses the "dot-label" modifier for invisible unraised dots.
function buildHeadingCells() {
  const container = document.getElementById("heading-cells");
  if (!container) return;

  container.innerHTML = "";
  unicodeStringToBitmasks(HEADING_BRAILLE).forEach(bm => {
    container.appendChild(buildCellSpan(bm, "dot-label"));
  });
}

// Builds one visual braille cell (span.cell > 6x span.dot.dot-N[.on]) from an
// 8-bit bitmask string in the same position convention as brlunicode-mapping.json
// (see BITMASK_DOT_ORDER above for the position-to-dot-number mapping). Purely
// visual/decorative — the row's aria-braillelabel remains the source of truth
// for assistive tech, so these cells don't need their own ARIA attributes.
// extraDotClass is optional — pass "dot-label" for label contexts (heading,
// board header) where unraised dots should be fully invisible rather than
// the normal dark-red unraised-dot styling used on the board/six-key widget.
function buildCellSpan(bitmaskStr, extraDotClass) {
  const cell = document.createElement("span");
  cell.className = "cell";
  for (let dotNum = 1; dotNum <= 6; dotNum++) {
    const position = BITMASK_DOT_ORDER.indexOf(dotNum);
    const dot = document.createElement("span");
    dot.className = "dot dot-" + dotNum + (extraDotClass ? " " + extraDotClass : "");
    if (bitmaskStr && position !== -1 && bitmaskStr[position] === "1") {
      dot.classList.add("on");
    }
    cell.appendChild(dot);
  }
  return cell;
}

// Builds one aria-hidden group of cells (e.g. the "guess" column) from an
// array of 8-bit bitmask strings. extraDotClass is forwarded to buildCellSpan.
function buildRowGroup(bitmaskArray, groupClass, extraDotClass) {
  const group = document.createElement("span");
  group.className = "row-group " + groupClass;
  group.setAttribute("aria-hidden", "true");
  bitmaskArray.forEach(bm => group.appendChild(buildCellSpan(bm, extraDotClass)));
  return group;
}

// Converts a string of Unicode braille characters into an array of 8-bit
// bitmask strings, looked up the same way guesses/targets already are.
function unicodeStringToBitmasks(str) {
  const out = [];
  for (const ch of str) {
    out.push(asciiToDots[ch] || "00000000");
  }
  return out;
}

function renderRow({ guessIndex, ariaBrailleLabel, correctBitmasks, guessBitmasks, wrongBitmasks }) {
  const board = document.getElementById("game-board");
  const row = document.createElement("div");
  row.className = "row";
  row.tabIndex = -1;

  row.setAttribute("aria-braillelabel", ariaBrailleLabel);
  row.setAttribute("aria-label", `Row ${guessIndex + 1}`);

  const rowLabel = document.createElement("span");
  rowLabel.className = "row-label";
  rowLabel.setAttribute("aria-hidden", "true");
  rowLabel.textContent = String(guessIndex + 1);
  row.appendChild(rowLabel);

  row.appendChild(buildRowGroup(correctBitmasks, "row-group-correct"));
  row.appendChild(buildRowGroup(guessBitmasks, "row-group-guess"));
  row.appendChild(buildRowGroup(wrongBitmasks, "row-group-wrong"));

  board.appendChild(row);
  row.focus();
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
    if (!isRestoring) setStatus("Not in word list.");
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

  renderRow({
    guessIndex: currentGuess,
    ariaBrailleLabel: formatRow({
      guessIndex: currentGuess,
      correct: dotsArrayToAsciiString(rowCorrectStrings),
      guess: guessAsUnicode,
      wrong: dotsArrayToAsciiString(rowWrongStrings),
    }),
    correctBitmasks: rowCorrectStrings,
    guessBitmasks: guessDotsArray,
    wrongBitmasks: rowWrongStrings,
  });

  currentGuess++;
  updateGuessLabel();

  const isMatch = (matchedWord.print.toLowerCase() === WORD_OF_THE_DAY.print.toLowerCase());

  if (isMatch) {
    setStatus(WIN_STATUS_MESSAGE);
    gameOver = true;
    showPostGameSuggestForm();
    if (!isRestoring) lockControls();
  } else if (currentGuess >= MAX_GUESSES) {
    setStatus(LOSE_STATUS_MESSAGE);
    gameOver = true;
    showPostGameSuggestForm();
    if (!isRestoring) lockControls();
  }

  return true;
}

// Shared submission path for both standard text input and six-key entry.
// Takes either plain print text or a Unicode braille string (evaluateAndRenderGuess
// already handles both). Returns true if the guess was valid and accepted.
function submitRawGuess(rawGuess) {
  // If local midnight has passed since load (e.g. a tab left open overnight),
  // reset to today's puzzle before evaluating anything.
  if (checkForNewDay()) return false;

  if (gameOver || !WORD_OF_THE_DAY) return false;
  if (!rawGuess) return false;

  const statusDiv = document.getElementById("status");
  statusDiv.setAttribute("hidden", "");
  statusDiv.textContent = "";

  const success = evaluateAndRenderGuess(rawGuess, false);

  if (success) {
    // Commit the new entry to permanent storage records
    const historicalGuesses = getStoredGuesses();
    historicalGuesses.push(rawGuess);
    saveGameState(historicalGuesses);
  }

  return success;
}

function submitGuess() {
  const input = document.getElementById("guess-input");
  const rawGuess = input.value.trim();
  if (!rawGuess) return;

  const success = submitRawGuess(rawGuess);
  if (success) {
    input.value = "";
  }
}

async function init() {
  await Promise.all([loadMapping(), loadDailyWords()]);

  buildHeadingCells();
  buildHeaderCells();

  if (allWords.length > 0) {
    activeDayIndex = todayDayIndex();
    WORD_OF_THE_DAY = getWordForDayIndex(activeDayIndex);
    const debugLog = document.getElementById("debug-log");
    if (debugLog) debugLog.textContent = ""; 
    
    // Core game state loading cycle runs immediately when dictionary data arrives
    loadAndRestoreGameState();
  } else {
    mobileLog("Critical: No words loaded. Check JSON files.");
  }

  const input = document.getElementById("guess-input");
  const button = document.getElementById("submit-btn");

  button.addEventListener("click", submitGuess);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitGuess();
    }
  });

  // Six-key entry mode wiring
  loadInputModePreference();

  const modeToggleBtn = document.getElementById("mode-toggle-btn");
  const sixkeyCellsEl = document.getElementById("sixkey-cells");
  const sixkeyClearBtn = document.getElementById("sixkey-clear-btn");
  const sixkeySubmitBtn = document.getElementById("sixkey-submit-btn");

  if (modeToggleBtn) {
    modeToggleBtn.addEventListener("click", toggleInputMode);
  }
  if (sixkeyCellsEl) {
    sixkeyCellsEl.addEventListener("click", handleSixKeyDotClick);
    sixkeyCellsEl.addEventListener("keydown", handleSixKeyKeydown);
    sixkeyCellsEl.addEventListener("keyup", handleSixKeyKeyup);
    // If focus leaves the widget mid-chord (e.g. switching apps on mobile),
    // don't leave a phantom chord state hanging around.
    sixkeyCellsEl.addEventListener("blur", () => {
      chordKeysHeld = new Set();
      chordDotsPressed = new Set();
    });
  }
  if (sixkeyClearBtn) {
    sixkeyClearBtn.addEventListener("click", () => {
      if (gameOver) return;
      clearAllSixKey();
    });
  }
  if (sixkeySubmitBtn) {
    sixkeySubmitBtn.addEventListener("click", submitSixKeyGuess);
  }

  const suggestSubmitBtn = document.getElementById("suggest-submit-btn");
  if (suggestSubmitBtn) {
    suggestSubmitBtn.addEventListener("click", submitWordSuggestions);
  }

  applyInputMode();

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      checkForNewDay();
    }
  });

  updateGuessLabel();
}

init().catch(e => mobileLog("Init Error: " + e.message));
