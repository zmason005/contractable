"use strict";

/*
 * Contractable demo recorder.
 * Watches the page while the game is played and writes down what happened,
 * with timestamps counted from the moment start() is called.
 *
 * Two kinds of watching:
 *   - the person's actions: clicks/taps, keys, typing, focus, scrolling
 *   - the game's responses: new rows, status messages, instructions opening,
 *     the suggest-words form, six-key announcements, input mode changes
 *
 * stop() returns { json, markdown, duration }.
 */
(function () {
  const TYPING_PAUSE_MS = 500;
  const SCROLL_PAUSE_MS = 200;
  const LONG_GAP_MS = 2000;

  const NAMES = {
    "guess-input": "guess field",
    "submit-btn": "Submit button",
    "sixkey-cells": "six-key entry area",
    "sixkey-submit-btn": "six-key Submit button",
    "sixkey-clear-btn": "six-key Clear button",
    "mode-toggle-btn": "input mode toggle button",
    "instructions-btn": "Instructions button (top)",
    "suggest-input": "suggest-words box",
    "suggest-submit-btn": "Send suggestions button",
    "status": "status message"
  };

  let running = false;
  let t0 = 0;
  let events = [];
  let meta = {};
  let cleanups = [];
  let observers = [];
  let lastFocus = "";
  let lastScrollY = 0;
  let scrollTimer = null;
  const typingTimers = new Map();

  const $ = (id) => document.getElementById(id);
  const now = () => Math.round(performance.now() - t0);

  function log(type, detail) {
    if (running) events.push(Object.assign({ t: now(), type: type }, detail || {}));
  }

  function on(target, evt, fn, opts) {
    target.addEventListener(evt, fn, opts);
    cleanups.push(() => target.removeEventListener(evt, fn, opts));
  }

  function observe(el, options, cb) {
    if (!el) return;
    const mo = new MutationObserver(cb);
    mo.observe(el, options);
    observers.push(mo);
  }

  /* ── Describing things in plain words ─────────────────────────────────── */

  function describe(el) {
    if (!el || !el.closest) return "the page";
    const dot = el.closest(".dot");
    if (dot && dot.dataset.dot) {
      return "dot " + dot.dataset.dot + " of braille cell " + (Number(dot.dataset.cell) + 1);
    }
    const named = el.closest("button, input, textarea, [id], [aria-label]");
    if (!named) return el.tagName.toLowerCase();
    if (named.id && NAMES[named.id]) return NAMES[named.id];
    const cell = el.closest(".cell[data-cell]");
    if (cell) return "braille cell " + (Number(cell.dataset.cell) + 1);
    const label = named.getAttribute("aria-label") ||
      (named.tagName === "BUTTON" ? named.textContent.trim() : "") ||
      named.id || named.tagName.toLowerCase();
    const kind = named.tagName === "BUTTON" ? "button" : "element";
    return kind + " \u201C" + label.slice(0, 60) + "\u201D";
  }

  // Reads the six-key cells straight off the screen as braille characters.
  function sixKeyBraille() {
    return Array.from(document.querySelectorAll("#sixkey-cells .cell")).map(cell => {
      let mask = 0;
      cell.querySelectorAll(".dot.on").forEach(d => { mask |= 1 << (Number(d.dataset.dot) - 1); });
      return String.fromCharCode(0x2800 + mask);
    }).join("");
  }

  function fieldName(el) {
    return el.id === "guess-input" ? "guess field" : "suggest-words box";
  }

  function logTyped(el) {
    const timer = typingTimers.get(el);
    if (timer) clearTimeout(timer);
    typingTimers.delete(el);
    if (el.value) log("typed", { field: fieldName(el), value: el.value });
  }

  function flushTyping() {
    Array.from(typingTimers.keys()).forEach(logTyped);
  }

  function statusMeaning(text) {
    if (text.indexOf("\u2820\u2820\u283D") !== -1) return "You win!";
    if (text.indexOf("\u280E\u2815\u2817\u2817\u283D") !== -1) return "Sorry, game over.";
    return "";
  }

  /* ── Person's actions ─────────────────────────────────────────────────── */

  function watchActions() {
    on(document, "click", (e) => {
      if (e.target.closest && e.target.closest("#end-recording-btn")) return;
      flushTyping();
      log("click", {
        target: describe(e.target),
        x: Math.round(e.clientX), y: Math.round(e.clientY),
        via: e.detail === 0 ? "keyboard" : (e.pointerType || "pointer")
      });
      if (e.target.closest("#submit-btn")) {
        log("guess_submit", { mode: "standard", value: $("guess-input").value.trim() });
      } else if (e.target.closest("#sixkey-submit-btn")) {
        log("guess_submit", { mode: "six-key", value: sixKeyBraille() });
      }
    }, true);

    on(document, "keydown", (e) => {
      const t = e.target;
      if (t.closest && t.closest("#end-recording-btn")) return;
      if (e.repeat) return;
      if (e.key === "Enter") flushTyping();
      const inField = t.tagName === "INPUT" || t.tagName === "TEXTAREA";
      log("key", {
        key: e.key,
        target: describe(t),
        typing: inField && e.key.length === 1 && !e.ctrlKey && !e.metaKey,
        shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey
      });
      if (e.key === "Enter") {
        if (t.id === "guess-input") {
          log("guess_submit", { mode: "standard", value: t.value.trim() });
        } else if (t.id === "sixkey-cells") {
          log("guess_submit", { mode: "six-key", value: sixKeyBraille() });
        }
      }
    }, true);

    on(document, "keyup", (e) => {
      if (e.target.closest && e.target.closest("#end-recording-btn")) return;
      log("keyup", { key: e.key, target: describe(e.target) });
    }, true);

    on(document, "input", (e) => {
      const el = e.target;
      if (el.id !== "guess-input" && el.id !== "suggest-input") return;
      const old = typingTimers.get(el);
      if (old) clearTimeout(old);
      typingTimers.set(el, setTimeout(() => logTyped(el), TYPING_PAUSE_MS));
    }, true);

    on(document, "focusin", (e) => {
      const d = describe(e.target);
      if (d !== lastFocus && !(e.target.closest && e.target.closest("#end-recording-btn"))) {
        lastFocus = d;
        log("focus", { target: d });
      }
    }, true);

    on(window, "scroll", () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        const y = Math.round(window.scrollY);
        if (Math.abs(y - lastScrollY) < 2) return;
        const mid = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
        const idEl = mid && mid.closest ? mid.closest("[id]") : null;
        log("scroll", {
          y: y,
          direction: y > lastScrollY ? "down" : "up",
          near: idEl ? idEl.id : (mid ? mid.tagName.toLowerCase() : ""),
          atTop: y <= 0,
          atBottom: window.innerHeight + y >= document.documentElement.scrollHeight - 4
        });
        lastScrollY = y;
      }, SCROLL_PAUSE_MS);
    }, { passive: true });
  }

  /* ── The game's responses ─────────────────────────────────────────────── */

  function watchGame() {
    const board = $("game-board");
    observe(board, { childList: true }, (muts) => {
      muts.forEach(m => m.addedNodes.forEach(n => {
        if (n.nodeType === 1 && n.classList.contains("row") && n.id !== "header") {
          log("row_added", {
            label: n.getAttribute("aria-label"),
            braille: n.getAttribute("aria-braillelabel")
          });
        }
      }));
    });

    const st = $("status");
    let last = { text: st.hasAttribute("hidden") ? "" : st.textContent.trim(), hidden: st.hasAttribute("hidden") };
    observe(st, { attributes: true, childList: true, characterData: true, subtree: true }, () => {
      const cur = { text: st.textContent.trim(), hidden: st.hasAttribute("hidden") };
      if (!cur.hidden && cur.text && (cur.text !== last.text || last.hidden)) {
        log("status", { text: cur.text, meaning: statusMeaning(cur.text), dismissible: st.classList.contains("dismissible") });
      } else if (cur.hidden && !last.hidden) {
        log("status_hidden");
      }
      last = cur;
    });

    const watchHidden = (id, type, key) => {
      const el = $(id);
      if (!el) return;
      let was = el.hidden;
      observe(el, { attributes: true, attributeFilter: ["hidden"] }, () => {
        if (el.hidden !== was) {
          was = el.hidden;
          log(type, key(!el.hidden));
        }
      });
    };
    watchHidden("instructions-panel", "instructions", (open) => ({ open: open }));
    watchHidden("post-game-suggest", "suggest_form", (visible) => ({ visible: visible }));
    watchHidden("sixkey-controls", "input_mode", (sixkey) => ({ mode: sixkey ? "six-key" : "standard" }));

    const watchText = (id, type) => {
      observe($(id), { childList: true, characterData: true, subtree: true }, () => {
        const text = $(id).textContent.trim();
        if (text) log(type, { text: text });
      });
    };
    watchText("suggest-feedback", "suggest_feedback");
    watchText("sixkey-live", "sixkey_announce");
  }

  /* ── Turning events into a timeline ───────────────────────────────────── */

  function fmt(ms) {
    const s = ms / 1000;
    const m = Math.floor(s / 60);
    return m + ":" + (s - m * 60).toFixed(1).padStart(4, "0");
  }

  function keyName(k) {
    return k === " " ? "Space" : k;
  }

  function narrate(ev) {
    switch (ev.type) {
      case "click":
        return (ev.via === "keyboard" ? "Activated " : (ev.via === "touch" ? "Tapped " : "Clicked ")) + ev.target;
      case "key":
        if (ev.typing) return null; // covered by the "typed" lines
        return "Pressed " + keyName(ev.key) + " in " + ev.target;
      case "typed":
        return "Typed \u201C" + ev.value + "\u201D in the " + ev.field;
      case "guess_submit":
        return "Submitted guess (" + ev.mode + "): " + (ev.value || "(empty)");
      case "row_added":
        return "GAME: " + ev.label + " appeared. Braille: " + ev.braille;
      case "status":
        return "GAME: Status message \u201C" + ev.text + "\u201D" + (ev.meaning ? " (means: " + ev.meaning + ")" : "");
      case "status_hidden":
        return "GAME: Status message cleared";
      case "instructions":
        return "GAME: Instructions panel " + (ev.open ? "opened" : "closed");
      case "suggest_form":
        return "GAME: Suggest-words form " + (ev.visible ? "appeared" : "hidden");
      case "suggest_feedback":
        return "GAME: Suggest-words message \u201C" + ev.text + "\u201D";
      case "sixkey_announce":
        return "GAME: Six-key announcement \u201C" + ev.text + "\u201D";
      case "input_mode":
        return "GAME: Switched to " + ev.mode + " entry";
      case "focus":
        return "Focus moved to " + ev.target;
      case "scroll":
        return "Scrolled " + ev.direction + " to " + (ev.atTop ? "the top" : (ev.atBottom ? "the bottom" : "y=" + ev.y)) + " (near " + ev.near + ")";
      default:
        return null; // keyup and anything else stay in the JSON only
    }
  }

  function buildMarkdown(duration) {
    const lines = [];
    lines.push("# Contractable tutorial recording");
    lines.push("");
    lines.push("Timeline of one play-through, for writing narration. Times count from the moment recording started. Lines starting with GAME: are what the game did in response.");
    lines.push("");
    lines.push("- Answer used for this demo: " + meta.word + " (braille " + meta.braille + ")");
    lines.push("- Started: " + meta.startedAt);
    lines.push("- Length: " + fmt(duration));
    lines.push("- Screen: " + meta.viewport);
    lines.push("");
    lines.push("## Timeline");
    lines.push("");
    lines.push("- 0:00.0 \u2013 Recording started");

    let prev = 0;
    events.forEach(ev => {
      const text = narrate(ev);
      if (!text) return;
      if (ev.t - prev > LONG_GAP_MS) {
        lines.push("- [pause " + ((ev.t - prev) / 1000).toFixed(1) + " s]");
      }
      lines.push("- " + fmt(ev.t) + " \u2013 " + text);
      prev = ev.t;
    });

    lines.push("- " + fmt(duration) + " \u2013 Recording ended");
    return lines.join("\n");
  }

  /* ── Public API ───────────────────────────────────────────────────────── */

  function start(info) {
    if (running) return;
    events = [];
    cleanups = [];
    observers = [];
    typingTimers.clear();
    lastFocus = "";
    lastScrollY = Math.round(window.scrollY);
    meta = {
      word: info.word,
      braille: info.braille,
      startedAt: new Date().toISOString(),
      viewport: window.innerWidth + "x" + window.innerHeight + " at " + window.devicePixelRatio + "x",
      userAgent: navigator.userAgent
    };
    t0 = performance.now();
    running = true;
    watchActions();
    watchGame();
    log("start");
  }

  function stop() {
    if (!running) return { json: "{}", markdown: "", duration: 0 };
    flushTyping();
    const duration = now();
    running = false;
    clearTimeout(scrollTimer);
    cleanups.forEach(fn => fn());
    observers.forEach(mo => mo.disconnect());
    const json = JSON.stringify({ meta: meta, durationMs: duration, events: events }, null, 2);
    return { json: json, markdown: buildMarkdown(duration), duration: duration };
  }

  window.DemoRecorder = { start: start, stop: stop };
})();
