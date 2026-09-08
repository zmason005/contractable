/* ── Guess Evaluation & Game Controller ──────────────────────────────────── */

function evaluateAndRenderGuess(guessAsUnicode, isRestoring = false) {
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
