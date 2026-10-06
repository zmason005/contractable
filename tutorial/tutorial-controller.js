"use strict";

/* ── Settings table: one row per toggle ──────────────────────────────────
   id      = checkbox id in the modal
   default = value before the user ever changes it
   apply   = optional side effect when the value changes
---------------------------------------------------------------------------*/
const PREF_TABLE = {
  audio:    { id: "opt-audio",    default: true  },
  captions: { id: "opt-captions", default: true  },
  contrast: { id: "opt-contrast", default: false,
              apply: on => document.documentElement.classList.toggle("high-contrast", on) },
  snap:     { id: "opt-snap",     default: false },
  manual:   { id: "opt-manual",   default: true  },
};

const PREFS_KEY = "contractable_tutorial_prefs";

/* Replace with your real segments (same shape as the handoff schema) */
const TUTORIAL_SEGMENTS = [
  {
    id: "step_01_intro",
    title: "Step 1: Understanding the Cell Structure",
    audioSrc: "assets/audio/tut_step1.mp3",
    captionText: "Welcome to CONTRACTABLE. Braille cells consist of six dot positions.",
    brailleUnicode: "⠠⠺⠑⠇⠉⠕⠍⠑⠀⠞⠕⠀⠠⠉⠕⠝⠞⠗⠁⠉⠞⠁⠃⠇⠑",
    highlightElementId: "game-board",
  },
];

class SegmentedTutorialController {
  constructor(segments) {
    this.segments = segments;
    this.index = 0;
    this.prefs = this.loadPrefs();
    this.audio = new Audio();
    this.audio.addEventListener("ended", () => this.onAudioEnded());

    this.live    = document.getElementById("tutorial-live-region");
    this.caption = document.getElementById("tutorial-caption"); // visible caption box (tabindex="-1")

    this.bindPrefInputs();
  }

  /* ── Preferences ─────────────────────────────────────────────────────── */

  loadPrefs() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch (e) {}
    const prefs = {};
    for (const [key, def] of Object.entries(PREF_TABLE)) {
      prefs[key] = key in saved ? !!saved[key] : def.default;
    }
    return prefs;
  }

  bindPrefInputs() {
    for (const [key, def] of Object.entries(PREF_TABLE)) {
      const box = document.getElementById(def.id);
      if (!box) continue;
      box.checked = this.prefs[key];          // show saved state in the modal
      if (def.apply) def.apply(this.prefs[key]); // apply on startup too
      box.addEventListener("change", () => {
        this.prefs[key] = box.checked;
        if (def.apply) def.apply(box.checked);
        try { localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs)); } catch (e) {}
        if (key === "audio" && !box.checked) this.stopAudio();
      });
    }
  }

  /* ── Audio (pause-on-interruption) ───────────────────────────────────── */

  stopAudio() {
    this.audio.pause();
    this.audio.currentTime = 0;
  }

  onAudioEnded() {
    if (!this.prefs.manual) this.next(); // auto-advance only when manual pacing is off
  }

  /* ── Navigation ──────────────────────────────────────────────────────── */

  go(i) {
    if (i < 0 || i >= this.segments.length) return;
    this.stopAudio();            // always silence the old step first
    this.index = i;
    this.present(this.segments[i]);
  }

  next()   { this.go(this.index + 1); }
  prev()   { this.go(this.index - 1); }
  replay() { this.go(this.index); }
  start()  { this.go(0); }

  /* ── Presenting one step ─────────────────────────────────────────────── */

  present(seg) {
    this.highlight(seg.highlightElementId);

    if (this.prefs.audio && seg.audioSrc) {
      this.audio.src = seg.audioSrc;
      this.audio.play().catch(() => {}); // browsers may block autoplay; user can press Replay
    }

    this.renderCaption(seg);
    this.announce(seg);
  }

  highlight(id) {
    document.querySelectorAll(".tut-highlight")
      .forEach(el => el.classList.remove("tut-highlight"));
    const el = id && document.getElementById(id);
    if (el) el.classList.add("tut-highlight");
  }

  /* Visible caption box: speech label in English, tactile label in braille */
  renderCaption(seg) {
    if (!this.caption) return;
    this.caption.hidden = !this.prefs.captions;
    this.caption.setAttribute("aria-label", `${seg.title}. ${seg.captionText}`);
    this.caption.setAttribute("aria-braillelabel", seg.brailleUnicode);
    this.caption.textContent = seg.captionText;
  }

  /* Live region: swap in a fresh child so screen readers see a content change.
     Snapping replaces the live announcement (focus move would double it). */
  announce(seg) {
    if (!this.live) return;
    this.live.replaceChildren(); // clear old message

    if (this.prefs.snap && this.caption && !this.caption.hidden) {
      this.caption.focus();
      return;
    }

    const speaksCaption = this.prefs.captions || !this.prefs.audio; // never leave a step silent
    if (!speaksCaption) return;

    const msg = document.createElement("span");
    msg.setAttribute("aria-braillelabel", seg.brailleUnicode);
    msg.textContent = `${seg.title}. ${seg.captionText}`;
    // Insert on the next tick: gives screen readers a clean empty-to-filled change
    setTimeout(() => this.live.appendChild(msg), 50);
  }
}

/* Usage (after the DOM is ready):
   const tutorial = new SegmentedTutorialController(TUTORIAL_SEGMENTS);
   tutorial.start();
*/
