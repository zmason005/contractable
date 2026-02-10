Braille Wordle

Braille Wordle is a braille-first word game designed specifically for braille display users. Unlike visual-first games with accessibility layered on later, this project treats braille as the primary interface, with ASCII acting only as an interchange format.

The game uses Grade 2 Braille logic, supports contractions via a mapping table, and prioritizes predictable screen reader behavior over visual polish.

Design Principles

Braille-first, not screen-first

ASCII is an interchange format, not a user-facing abstraction

Predictable focus movement is more important than visual animation

Silence is better than surprise

Accessibility behavior is part of game logic, not decoration

How It Works

All user input is lowercase ASCII originating from a braille display

A single mapping file (braille-ascii-map.json) defines valid symbols

Input is converted into braille dot patterns for comparison

The game compares dot overlap, not letters

Exactly two status messages exist: win and lose

Status Messages

Win: ,,y ,,w96

Lose: ,sory1 ! ~w 0 <word>

Status messages:

Appear only at game conclusion

Are announced once

Receive programmatic focus

Project Status

This repository represents Braille Wordle v1.

Core gameplay, accessibility behavior, focus handling, and messaging are feature-locked. New ideas belong in a future version.

Files

index.html – Minimal UI and accessibility scaffolding

main.js – Game logic and accessibility behavior

braille-ascii-map.json – Single source of truth for symbols

accessibility.md – Accessibility design decisions

CONTRIBUTING.md – Contribution guidelines

License

MIT License. See LICENSE.md.
