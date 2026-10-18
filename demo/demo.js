"use strict";

/*
 * Demo launcher. Instead of keeping a second copy of the game, this page
 * borrows the live one: it copies the game markup and styles out of
 * ../index.html and then loads ../main.js, so the demo always matches the
 * real game. Three small "shims" make that safe:
 *   1. storage   - saved progress goes to memory, never your real localStorage
 *   2. network   - file paths point up one folder, the chosen word is added to
 *                  the word list, and Formspree suggestions are faked
 *   3. worker    - the braille translator is found in the parent folder
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const RealWorker = window.Worker;
  const realFetch = window.fetch.bind(window);

  let custom = null;        // { print, brlunicode } chosen on the setup screen
  let gameLoaded = false;   // true once ../main.js has been added to the page
  let lastResult = null;    // recorder output, for the download buttons

  function setError(msg) { $("setup-error").textContent = msg; }
  function announce(msg) { $("demo-live").textContent = msg; }

  /* ── Braille translation for the setup screen ─────────────────────────── */

  function translateToBraille(word) {
    return new Promise((resolve, reject) => {
      let w;
      try { w = new RealWorker("../louis-worker.js"); } catch (e) { reject(e); return; }
      const timer = setTimeout(() => {
        w.terminate();
        reject(new Error("Translation timed out. Paste the braille yourself, or try again."));
      }, 20000);
      w.onmessage = (evt) => {
        const d = evt.data || {};
        if (d.log) return; // liblouis diagnostics, not the answer
        clearTimeout(timer);
        w.terminate();
        if (d.ok && d.results && d.results[0]) resolve(d.results[0].brl || "");
        else reject(new Error(d.error || "Translation failed."));
      };
      w.onerror = () => {
        clearTimeout(timer);
        w.terminate();
        reject(new Error("The braille translator could not load. Paste the braille yourself."));
      };
      w.postMessage({ id: 1, words: [word] });
    });
  }

  /* ── Shims (installed once, just before the game loads) ───────────────── */

  function installShims() {
    if (installShims.done) return;
    installShims.done = true;

    // 1. Storage: game keys live in memory only.
    const mem = new Map();
    const mine = (store, key) =>
      store === window.localStorage && String(key).indexOf("contractable_") === 0;
    const P = Storage.prototype;
    const realGet = P.getItem, realSet = P.setItem, realRemove = P.removeItem;
    P.getItem = function (k) {
      return mine(this, k) ? (mem.has(k) ? mem.get(k) : null) : realGet.call(this, k);
    };
    P.setItem = function (k, v) {
      if (mine(this, k)) mem.set(k, String(v)); else realSet.call(this, k, v);
    };
    P.removeItem = function (k) {
      if (mine(this, k)) mem.delete(k); else realRemove.call(this, k);
    };

    // 2. Worker: main.js asks for "louis-worker.js"; it lives one folder up.
    window.Worker = function (url, opts) {
      return new RealWorker(url === "louis-worker.js" ? "../louis-worker.js" : url, opts);
    };

    // 3. Network.
    window.fetch = async function (input, init) {
      const url = typeof input === "string" ? input : (input && input.url) || "";

      if (url.indexOf("formspree.io") !== -1) {
        // Pretend the suggestion was sent so the "thank you" message shows.
        return new Response('{"ok":true}', {
          status: 200, headers: { "Content-Type": "application/json" }
        });
      }

      if (url === "brlunicode-mapping.json") {
        return realFetch("../brlunicode-mapping.json", init);
      }

      if (url === "daily-word4.json") {
        const res = await realFetch("../daily-word4.json", init);
        const list = await res.json();
        const entry = { id: 9999, print: custom.print, brlunicode: custom.brlunicode };
        // Drop any real word that would clash with the chosen one, then add it,
        // so it is both the answer and a legal guess.
        const merged = list.filter(w =>
          w.print.toLowerCase() !== entry.print && w.brlunicode !== entry.brlunicode);
        merged.push(entry);
        // main.js picks its answer with this function; point it at our word.
        window.getWordForDayIndex = function () { return entry; };
        return new Response(JSON.stringify(merged), {
          status: 200, headers: { "Content-Type": "application/json" }
        });
      }

      return realFetch(input, init);
    };
  }

  /* ── Borrow the live game ─────────────────────────────────────────────── */

  async function injectGame() {
    const res = await realFetch("../index.html");
    if (!res.ok) throw new Error("Could not load ../index.html.");
    const doc = new DOMParser().parseFromString(await res.text(), "text/html");

    doc.querySelectorAll("style").forEach(st => {
      const copy = document.createElement("style");
      copy.textContent = st.textContent;
      document.head.appendChild(copy);
    });

    const app = doc.querySelector(".app-container");
    if (!app) throw new Error("Could not find the game in ../index.html.");
    app.querySelectorAll("#about, script").forEach(n => n.remove());
    $("game-host").innerHTML = app.outerHTML;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Could not load " + src + "."));
      document.head.appendChild(s); // head, so the End button stays last in the body
    });
  }

  // main.js finishes its setup in the same moment it picks the answer.
  function waitForGame() {
    return new Promise((resolve, reject) => {
      const began = Date.now();
      const timer = setInterval(() => {
        let ready = false;
        try { ready = typeof WORD_OF_THE_DAY !== "undefined" && WORD_OF_THE_DAY !== null; } catch (e) {}
        if (ready) { clearInterval(timer); resolve(); }
        else if (Date.now() - began > 10000) {
          clearInterval(timer);
          reject(new Error("The game did not finish loading."));
        }
      }, 50);
    });
  }

  /* ── Start ────────────────────────────────────────────────────────────── */

  async function startRecording(e) {
    e.preventDefault();
    setError("");

    const print = $("demo-word").value.trim().toLowerCase();
    let braille = $("demo-braille").value.replace(/\s+/g, "");
    const btn = $("start-recording-btn");

    if (!/^[a-z]{2,}$/.test(print)) {
      setError("Enter the word using letters only.");
      return;
    }
    if (gameLoaded) {
      setError("Reload the page to start a new recording.");
      return;
    }

    btn.disabled = true;
    try {
      if (!braille) {
        setError("Translating to braille\u2026");
        braille = await translateToBraille(print);
        setError("");
      }

      const cells = Array.from(braille);
      if (!cells.length || !cells.every(ch => ch >= "\u2801" && ch <= "\u283F")) {
        throw new Error("The braille must use 6-dot braille characters only.");
      }
      if (cells.length !== 5) {
        throw new Error(
          "\u201C" + print + "\u201D is " + cells.length + " braille cells (" + braille +
          "). The board needs exactly 5. Try another word, or paste 5 cells yourself.");
      }

      custom = { print: print, brlunicode: braille };
      installShims();
      await injectGame();
      $("game-host").hidden = false;     // visible first, so the game can focus its input
      gameLoaded = true;
      await loadScript("../main.js");
      await waitForGame();

      $("setup-screen").hidden = true;
      $("end-recording-btn").hidden = false;
      window.DemoRecorder.start({ word: print, braille: braille });
      announce("Recording started. The End Recording button is at the bottom of the page.");
    } catch (err) {
      btn.disabled = false;
      if (gameLoaded) {
        $("game-host").hidden = true;
        setError(err.message + " Reload the page to try again.");
      } else {
        setError(err.message);
      }
    }
  }

  /* ── End and export ───────────────────────────────────────────────────── */

  function download(name, text, mime) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: mime }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  function baseName() {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    return "contractable-demo-" + custom.print + "-" + stamp;
  }

  async function copyTimeline() {
    const text = lastResult.markdown;
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = $("results-text");
      ta.focus();
      ta.select();
      document.execCommand("copy");
    }
    $("results-status").textContent = "Timeline copied.";
  }

  function endRecording() {
    lastResult = window.DemoRecorder.stop();
    $("game-host").hidden = true;
    $("end-recording-btn").hidden = true;
    $("results-text").value = lastResult.markdown;
    $("results").hidden = false;
    $("results-heading").focus();
    announce("Recording ended.");
  }

  /* ── Wire up ──────────────────────────────────────────────────────────── */

  $("setup-form").addEventListener("submit", startRecording);
  $("end-recording-btn").addEventListener("click", endRecording);
  $("download-md-btn").addEventListener("click", () => {
    download(baseName() + ".md", lastResult.markdown, "text/markdown");
    $("results-status").textContent = "Timeline downloaded.";
  });
  $("download-json-btn").addEventListener("click", () => {
    download(baseName() + ".json", lastResult.json, "application/json");
    $("results-status").textContent = "JSON downloaded.";
  });
  $("copy-md-btn").addEventListener("click", copyTimeline);
})();
