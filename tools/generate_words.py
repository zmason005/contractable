import json
import re
import random
import subprocess
import louis
from better_profanity import profanity
from proper_nouns import is_proper_noun

random.seed()  # non-deterministic per run; change to a fixed seed for reproducibility

TARGET_COUNT = 100          # upper bound on how many we output this run
MIN_LETTERS = 5
BATCH_OVERSHOOT = 6000      # how many raw candidates to try translating before giving up

# ── Load supporting data ──────────────────────────────────────────────────
with open("brlunicode-mapping.json") as f:
    mapping = json.load(f)

ascii_to_unicode = {}
for item in mapping:
    if item.get("printAscii"):
        ascii_to_unicode[item["printAscii"]] = item["unicodeChar"]

# Known broken contraction-stem artifacts present in some dictionary word lists
# (e.g. "couldn" from a mis-split "couldn't"). Only the unambiguous ones -
# words like "don" or "cant" or "wont" are real standalone words, so they're
# deliberately left out of this blocklist.
CONTRACTION_STEMS = {
    "couldn", "doesn", "shouldn", "wouldn", "isn", "aren",
    "hasn", "wasn", "weren", "haven", "hadn", "didn", "mustn", "neednt",
}

def is_plural_form(word, dictionary_words):
    """True if `word` looks like the plural of a shorter word that's also
    a valid dictionary entry (e.g. 'balls' -> 'ball', 'cases' -> 'case',
    'boxes' -> 'box', 'parties' -> 'party')."""
    if word.endswith("ies") and len(word) > 4:
        singular = word[:-3] + "y"
        if singular in dictionary_words:
            return True
    if word.endswith("es") and len(word) > 3:
        for cut in (1, 2):  # handles both "cases"->"case" and "boxes"->"box"
            singular = word[: -cut]
            if singular in dictionary_words and singular != word:
                return True
    if word.endswith("s") and not word.endswith("ss") and len(word) > 3:
        singular = word[:-1]
        if singular in dictionary_words and singular != word:
            return True
    return False

name_set = set()
for fname in ("first_names.txt", "us_names.txt"):
    with open(fname) as f:
        for line in f:
            n = line.strip().lower()
            if n:
                name_set.add(n)

with open("daily-word4.json") as f:
    existing_words = json.load(f)

existing_prints = set(w["print"].strip().lower() for w in existing_words)
existing_brl = set(w["brlunicode"] for w in existing_words)

print(f"Existing bank: {len(existing_words)} words ({len(existing_prints)} unique prints, "
      f"{len(existing_brl)} unique braille forms)")

# ── Load frequency-ranked common-word list (gate for recognizability) ────
FREQ_RANK_CUTOFF = 50000  # only consider words within top N most common (whole file here)

freq_rank = {}
with open("en_freq.txt") as f:
    for i, line in enumerate(f):
        parts = line.strip().split()
        if not parts:
            continue
        word = parts[0].lower()
        if word not in freq_rank:  # keep first (highest-ranked) occurrence
            freq_rank[word] = i

# ── Load & pre-filter raw candidate word list, gated by frequency rank ───
with open("words_alpha.txt") as f:
    dictionary_words = set(w.strip().lower() for w in f if w.strip())

candidates = []
seen = set()
for word, rank in freq_rank.items():
    if rank >= FREQ_RANK_CUTOFF:
        continue
    if len(word) < MIN_LETTERS:
        continue
    if not re.fullmatch(r"[a-z]+", word):
        continue  # drops contractions like "it's", "don't", proper-noun-ish tokens with punctuation
    if word not in dictionary_words:
        continue  # not a real dictionary word (drops typos/slang picked up from subtitles)
    if word in name_set:
        continue  # drops common first names (subtitle corpora are full of character names)
    if is_proper_noun(word):
        continue  # drops countries, demonyms, US states/capitals, common surnames
    if word in CONTRACTION_STEMS:
        continue  # drops broken contraction-fragment artifacts in the source dictionary
    if is_plural_form(word, dictionary_words):
        continue  # drops plurals (and other -s inflections) of a shorter dictionary word
    if word in existing_prints:
        continue
    if word in seen:
        continue
    if profanity.contains_profanity(word):
        continue
    seen.add(word)
    candidates.append(word)

# Sort by frequency rank (most common first) rather than shuffling,
# so the highest-recognizability words get first shot at filling the batch.
candidates.sort(key=lambda w: freq_rank[w])

print(f"Candidates after frequency-gate/length/alpha/dictionary/dedupe/profanity filter: {len(candidates)}")

candidates = candidates[:BATCH_OVERSHOOT]

# ── Translate via liblouis grade 2 UEB, keep exact 5-cell results ────────
tables = ["en-ueb-g2.ctb"]
results = []
seen_brl_this_run = set()

for word in candidates:
    if len(results) >= TARGET_COUNT:
        break
    try:
        braille_ascii = louis.translateString(tables, word)
    except Exception:
        continue

    if len(braille_ascii) != 5:
        continue

    try:
        unicode_brl = "".join(ascii_to_unicode[ch] for ch in braille_ascii)
    except KeyError:
        continue  # a char in the output isn't in our mapping table; skip

    if unicode_brl in existing_brl or unicode_brl in seen_brl_this_run:
        continue  # a different word already occupies this exact braille pattern

    # Round-trip verification: back-translate and confirm it maps to the same word family
    try:
        back = louis.backTranslateString(tables, braille_ascii)
    except Exception:
        back = None
    if back is None or back.strip().lower() != word:
        continue

    seen_brl_this_run.add(unicode_brl)
    results.append((word, unicode_brl))

print(f"Final accepted words: {len(results)}")

results.sort(key=lambda x: x[0])  # alphabetical output

with open("import-words.txt", "w", encoding="utf-8") as f:
    for word, brl in results:
        f.write(f"{word} {brl}\n")

print("Wrote import-words.txt")
for word, brl in results[:15]:
    print(word, brl)
