(() => {
  const WORD_LENGTH = 5;
  const MAX_GUESSES = 6;
  const BRAILLE_BASE = 0x2800;

  const input = document.getElementById("guess-input");
  const submitBtn = document.getElementById("submit-btn");
  const rowsDiv = document.getElementById("rows");
  const srStatus = document.getElementById("sr-status");

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

  let currentRow = 0;
  let gameOver = false;

  // Example target (Unicode Braille, 5 cells)
  // Replace with your real word-of-the-day loader
  const target = "⠗⠥⠆⠝⠽";

  const correctDots = Array(WORD_LENGTH).fill(0);
  const wrongDots = Array(WORD_LENGTH).fill(0);

  function brailleMask(ch) {
    return ch.charCodeAt(0) - BRAILLE_BASE;
  }

  function brailleChar(mask) {
    return String.fromCharCode(BRAILLE_BASE + mask);
  }

  function renderRow(guess) {
    let correct = "";
    let wrong = "";

    for (let i = 0; i < WORD_LENGTH; i++) {
      correct += brailleChar(correctDots[i]);
      wrong += brailleChar(wrongDots[i]);
    }

    const row = document.createElement("div");
    row.textContent = `${correct} ${guess} ${wrong}`;
    rowsDiv.appendChild(row);
  }

  function speak(text) {
    srStatus.textContent = "";
    srStatus.textContent = text;
  }

  function endGame(win) {
    gameOver = true;
    input.disabled = true;
    submitBtn.disabled = true;
    speak(win ? "win" : "lose");
  }

  function submitGuess() {
    if (gameOver) return;

    const guess = input.value;

    if (guess.length !== WORD_LENGTH) {
      // Silent failure by design (no mystery speech)
      return;
    }

    for (let i = 0; i < WORD_LENGTH; i++) {
      const gMask = brailleMask(guess[i]);
      const tMask = brailleMask(target[i]);

      correctDots[i] |= gMask & tMask;
      wrongDots[i] |= gMask & ~tMask;
    }

    renderRow(guess);

    if (guess === target) {
      endGame(true);
      return;
    }

    currentRow++;
    if (currentRow >= MAX_GUESSES) {
      endGame(false);
      return;
    }

    input.value = "";
    input.focus();
  }

  // Canonical submission path
  submitBtn.addEventListener("click", submitGuess);

  // Ignore Enter on iOS (VoiceOver intercepts it anyway)
  input.addEventListener("keydown", e => {
    if (isIOS) return;
    if (e.key === "Enter") {
      submitGuess();
    }
  });

  // Enable game once loaded
  function init() {
    input.disabled = false;
    submitBtn.disabled = false;
    input.focus();
  }

  init();
})();
