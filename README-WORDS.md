# CONTRACTABLE: Adding Words to the Word Library

All words live in `daily-word4.json`. You normally never edit that file by hand. Instead you put words in `new-words.txt`, and `scripts/import-words.js` checks them and appends the good ones.

## What to type in new-words.txt

**Both the print word and its braille Unicode, on one line, separated by whitespace.**

```
print braille
```

Example (the line below is exactly what you type; use your own braille):

```
hello ⠓⠑⠇⠇⠕
```

### The rules

| Question | Answer |
|---|---|
| Print only, or print + braille? | **Both.** Print word first, braille second. A line with only one item is rejected as "malformed". |
| Spaces, tabs, or line breaks? | **One word per line** (a line break between words). Between the print word and the braille, use **one space or one tab**. Several spaces, or spaces/tabs at the start or end of the line, are fine too. |
| Braille format | Unicode braille characters (the dot-pattern symbols like ⠓⠑⠇⠇⠕), **exactly 5 cells**. Not computer-braille ASCII. |
| Print format | One word, no spaces. Use lowercase to match the rest of the bank. |
| Blank lines | Ignored. |
| Comments | **Not supported.** Anything extra on a line (for example `# note`) makes it malformed. |

### Pasting back rejected lines

When a line is rejected, the importer leaves it in `new-words.txt` with a reason added at the end, like this:

```
quilted ⠟⠥⠊⠇⠞⠫  # not 5 braille cells
```

Fix the braille, then **delete the `  # reason` part** before running again. If you leave it, the line has too many parts and is rejected as malformed.

## What the importer checks

A line is rejected if it is:

- malformed (not exactly two parts)
- not exactly 5 braille cells
- a duplicate print word, or a duplicate braille form (already in the bank or earlier in the same file)
- a proper noun
- a plural of a word already in the bank or the same batch (for example "cases" when "case" exists)

Accepted words get the next `id` (highest existing id plus 1) and are appended to `daily-word4.json`.

**It does not check that the braille is the correct Grade 2 UEB form for the print word.** Any 5 cells pass. Get the braille from the liblouis CLI (`lou_translate`, tables `unicode.dis,en-ueb-g2.ctb`) or from the generator, not from memory.

## Ways to add words

### Way 1: Push new-words.txt (automatic)

1. Put your lines in `new-words.txt` (format above).
2. Commit it to `main`.
3. The **Import New Words** workflow starts by itself, because a change to `new-words.txt` triggers it.
4. It commits the updated `daily-word4.json`, and leaves only rejected lines (if any) in `new-words.txt`. An empty `new-words.txt` means everything was accepted.

### Way 2: Run the import by hand

Use this if `new-words.txt` is already on `main` and you want to re-run, for example after fixing rejected lines in a separate commit.

1. Open the repo on GitHub, then **Actions**, then **Import New Words**.
2. Tap **Run workflow**.

### Way 3: Generate words automatically

1. Open **Actions**, then **Generate & Import Words**, then **Run workflow**.
2. It builds candidates with `tools/generate_words.py` (word-frequency and dictionary sources, with the proper noun, plural, and profanity filters) and imports them.

**Warning:** this workflow replaces the contents of `new-words.txt` with its own candidates before importing. Anything you hand-typed there and have not imported yet is lost. Import your own words first (Way 1 or 2), then run this.

The generator can run locally too (`python3 tools/generate_words.py`, which writes `import-words.txt`).

### Way 4: Edit daily-word4.json directly (last resort)

This skips every check above. Entry format:

```json
{ "id": 2575, "print": "example", "brlunicode": "⠑⠭⠁⠍⠏⠇⠑" }
```

Use a unique `id`, and a comma between entries with none after the last one. Run the checklist below afterward.

## Important: changing the list changes the daily words

The daily word comes from a shuffle seeded by date and by the whole list. Adding or removing any word reshuffles the schedule, including today's word, and players with saved guesses for today may see them replayed against a new target. Add words right after the daily rollover when you can.

## Quick checklist

- [ ] One word per line: `print`, one space or tab, then 5-cell braille Unicode
- [ ] Nothing else on the line (no comments, no extra words)
- [ ] Braille came from liblouis or the generator
- [ ] Old `# reason` text deleted from any re-submitted line
- [ ] Not running Way 3 while unimported hand-typed words are in the file
