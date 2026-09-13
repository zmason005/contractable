"use strict";

/**
 * Imports new word entries from new-words.txt into daily-word4.json.
 *
 * new-words.txt format: one entry per line, "print<whitespace>brlunicode"
 * e.g.  hello ⠓⠑⠇⠇⠕
 *
 * Accepted lines are appended to daily-word4.json with sequential ids.
 * Rejected lines (wrong cell count, or duplicate) are written back into
 * new-words.txt with a trailing "# reason" comment so they're easy to fix.
 */

const fs = require("fs");
const path = require("path");
const { isProperNoun } = require("./proper-nouns.js");

const ROOT = path.resolve(__dirname, "..");
const WORDS_TXT_PATH = path.join(ROOT, "new-words.txt");
const DAILY_WORD_JSON_PATH = path.join(ROOT, "daily-word4.json");

const BRAILLE_CELL_RE = /^[\u2800-\u28FF]{5}$/;

/**
 * True if `word` looks like the plural of a shorter word that's already
 * in the bank (e.g. "cases" -> "case", "boxes" -> "box", "parties" ->
 * "party"). This is a lighter-weight version of generate_words.py's
 * is_plural_form(): the GitHub Action has no bundled dictionary, so it
 * can only check against words already in the bank/batch rather than
 * the full English lexicon. It won't catch every plural (e.g. "acres"
 * when "acre" isn't in the bank yet), but it stops the exact failure
 * mode that let the last bad batch through: an -s form landing right
 * next to its already-present singular.
 */
function isPluralOfKnownWord(word, knownPrints) {
  if (word.endsWith("ies") && word.length > 4) {
    const singular = word.slice(0, -3) + "y";
    if (knownPrints.has(singular)) return true;
  }
  if (word.endsWith("es") && word.length > 3) {
    for (const cut of [1, 2]) {
      const singular = word.slice(0, -cut);
      if (singular !== word && knownPrints.has(singular)) return true;
    }
  }
  if (word.endsWith("s") && !word.endsWith("ss") && word.length > 3) {
    const singular = word.slice(0, -1);
    if (singular !== word && knownPrints.has(singular)) return true;
  }
  return false;
}

function loadDailyWords() {
  const raw = fs.readFileSync(DAILY_WORD_JSON_PATH, "utf8");
  return JSON.parse(raw);
}

function saveDailyWords(words) {
  fs.writeFileSync(DAILY_WORD_JSON_PATH, JSON.stringify(words, null, 2) + "\n", "utf8");
}

function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^(\S+)\s+(\S+)$/);
  if (!match) {
    return { malformed: true, raw: trimmed };
  }
  const [, print, brlunicode] = match;
  return { print, brlunicode, raw: trimmed };
}

function main() {
  if (!fs.existsSync(WORDS_TXT_PATH)) {
    console.log("No new-words.txt found; nothing to do.");
    return;
  }

  const existingWords = loadDailyWords();
  const existingPrints = new Set(existingWords.map(w => w.print.toLowerCase()));
  const existingBrl = new Set(existingWords.map(w => w.brlunicode));
  let maxId = existingWords.reduce((max, w) => Math.max(max, w.id), 0);

  const rawLines = fs.readFileSync(WORDS_TXT_PATH, "utf8").split("\n");

  const accepted = [];
  const rejectedLines = [];

  // Track prints/brlunicode seen within this batch to catch in-batch duplicates too.
  const batchPrints = new Set();
  const batchBrl = new Set();

  for (const line of rawLines) {
    const parsed = parseLine(line);
    if (parsed === null) continue; // blank line, drop silently

    if (parsed.malformed) {
      rejectedLines.push(`${parsed.raw}  # malformed line`);
      continue;
    }

    const { print, brlunicode, raw } = parsed;
    const printLower = print.toLowerCase();

    if (!BRAILLE_CELL_RE.test(brlunicode)) {
      rejectedLines.push(`${raw}  # not 5 braille cells`);
      continue;
    }

    if (existingPrints.has(printLower) || batchPrints.has(printLower)) {
      rejectedLines.push(`${raw}  # duplicate print`);
      continue;
    }

    if (existingBrl.has(brlunicode) || batchBrl.has(brlunicode)) {
      rejectedLines.push(`${raw}  # duplicate brlunicode`);
      continue;
    }

    if (isProperNoun(printLower)) {
      rejectedLines.push(`${raw}  # proper noun`);
      continue;
    }

    if (isPluralOfKnownWord(printLower, existingPrints) || isPluralOfKnownWord(printLower, batchPrints)) {
      rejectedLines.push(`${raw}  # plural of a word already in the bank`);
      continue;
    }

    maxId += 1;
    accepted.push({ id: maxId, print, brlunicode });
    batchPrints.add(printLower);
    batchBrl.add(brlunicode);
  }

  if (accepted.length > 0) {
    saveDailyWords(existingWords.concat(accepted));
  }

  // Leave only the rejected lines behind (empty file if everything succeeded).
  const newTxtContent = rejectedLines.length > 0 ? rejectedLines.join("\n") + "\n" : "";
  fs.writeFileSync(WORDS_TXT_PATH, newTxtContent, "utf8");

  console.log(`Accepted ${accepted.length} word(s).`);
  console.log(`Rejected ${rejectedLines.length} line(s).`);

  // Expose counts to the workflow via GITHUB_OUTPUT
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    fs.appendFileSync(
      githubOutput,
      `accepted_count=${accepted.length}\nrejected_count=${rejectedLines.length}\n`
    );
  }
}

main();
