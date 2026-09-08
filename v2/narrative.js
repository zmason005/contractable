/* ── Narrative Feedback Engine ───────────────────────────────────────────── */

const NarrativeEngine = {
  getDotNumbers(bitmaskStr) {
    if (!bitmaskStr || bitmaskStr.length < 8) return [];
    const dots = [];
    for (let i = 0; i < 8; i++) {
      if (bitmaskStr[i] === "1") {
        dots.push(BITMASK_DOT_ORDER[i]);
      }
    }
    return dots.sort((a, b) => a - b);
  },

  formatDotsList(dotsArr) {
    if (dotsArr.length === 0) return "no dots";
    if (dotsArr.length === 1) return `Dot ${dotsArr[0]}`;
    return `Dots ${dotsArr.join(", ")}`;
  },

  generateFeedback(guessUnicode, targetUnicode, guessNumber, isWin, isLoss) {
    const guessBitmasks = unicodeStringToBitmasks(guessUnicode);
    const targetBitmasks = unicodeStringToBitmasks(targetUnicode);

    let newlyFoundCount = 0;
    let newlyWrongCount = 0;
    const cellDetails = [];

    for (let i = 0; i < 5; i++) {
      const gMask = parseInt(guessBitmasks[i] || "00000000", 2);
      const tMask = parseInt(targetBitmasks[i] || "00000000", 2);

      const matchedInCell = gMask & tMask;
      const wrongInCell = gMask & ~tMask;

      if (matchedInCell > 0) newlyFoundCount++;
      if (wrongInCell > 0) newlyWrongCount++;

      const matchedDots = this.getDotNumbers(matchedInCell.toString(2).padStart(8, "0"));
      const wrongDots = this.getDotNumbers(wrongInCell.toString(2).padStart(8, "0"));

      let detailText = `Cell ${i + 1}: `;
      if (matchedDots.length === 0 && wrongDots.length === 0) {
        detailText += "No overlapping dots.";
      } else {
        const parts = [];
        if (matchedDots.length > 0) parts.push(`Correct (${this.formatDotsList(matchedDots)})`);
        if (wrongDots.length > 0) parts.push(`Incorrect (${this.formatDotsList(wrongDots)})`);
        detailText += parts.join(", ");
      }
      cellDetails.push(detailText);
    }

    let leadIn = `Guess ${guessNumber} Analysis: `;
    if (isWin) {
      leadIn += "Perfect match! Target word identified.";
    } else if (isLoss) {
      leadIn += `Game Over. Target word was ${WORD_OF_THE_DAY.print.toUpperCase()}.`;
    } else {
      leadIn += `Identified ${newlyFoundCount} correct cell group(s), ${newlyWrongCount} incorrect cell group(s).`;
    }

    const summaryBraille = dotsArrayToAsciiString(
      correctDots.map(val => val.toString(2).padStart(8, "0"))
    );

    const ariaText = isWin 
      ? `Congratulations! You solved the puzzle on guess ${guessNumber}.` 
      : isLoss 
      ? `Game over. The correct word was ${WORD_OF_THE_DAY.print}.` 
      : `Guess ${guessNumber} recorded. ${newlyFoundCount} cells contain correct dots.`;

    return { leadIn, cellDetails, summaryBraille, ariaText };
  }
};

function updateNarrativeStatus(guessUnicode, targetUnicode, guessNumber, isWin, isLoss, isRestoring = false) {
  const region = document.getElementById("status-narrative-region");
  const leadInEl = document.getElementById("narrative-lead-in");
  const listEl = document.getElementById("narrative-details-list");
  const summaryEl = document.getElementById("narrative-summary-display");
  const ariaEl = document.getElementById("narrative-aria-live");

  if (!region || !leadInEl || !listEl || !summaryEl || !ariaEl) return;

  const data = NarrativeEngine.generateFeedback(guessUnicode, targetUnicode, guessNumber, isWin, isLoss);

  leadInEl.textContent = data.leadIn;
  
  listEl.innerHTML = "";
  data.cellDetails.forEach(detail => {
    const li = document.createElement("li");
    li.textContent = detail;
    listEl.appendChild(li);
  });

  summaryEl.textContent = `Target Cumulative: ${data.summaryBraille}`;
  ariaEl.textContent = data.ariaText;

  region.removeAttribute("hidden");

  if (!isRestoring) {
    region.focus();
  }
}
