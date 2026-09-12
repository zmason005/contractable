"use strict";

/*
 * Dedicated worker that loads the liblouis browser build + Easy API and
 * exposes a tiny postMessage protocol for translating candidate suggestion
 * words into Grade 2 UEB braille, so main.js can verify a submitted word
 * actually occupies exactly 5 braille cells before it's sent to Formspree.
 *
 * This has to run in a worker (not the main thread) because liblouis's
 * on-demand table loading (enableOnDemandTableLoading) fetches .ctb/.dis
 * table files via synchronous XHR under the hood, and browsers only allow
 * synchronous XHR off the main thread.
 *
 * NOTE: this is unrelated to the desktop liblouis pipeline used to build
 * daily-word4.json (python-louis, which can't run on iOS). This is the
 * official liblouis C library cross-compiled to JS/WASM via emscripten,
 * running entirely client-side in the browser — it works fine on iOS
 * Safari because it's WASM/asm.js executed by the JS engine, not a native
 * shared library loaded at runtime.
 *
 * liblouis/js-build only publishes a 32-bit-Unicode build
 * (build-no-tables-utf32.js) — there is no "utf16" build despite that name
 * showing up in older liblouis-js docs/examples. easy-api.js auto-detects
 * the char width via charSize(), so the 32-bit build works transparently.
 *
 * Two mirrors are tried in order (jsdelivr first, since it's a real CDN;
 * raw.githubusercontent.com as a fallback, since GitHub doesn't guarantee
 * raw.githubusercontent.com as a CDN for production traffic).
 *
 * easyapi is loaded from a LOCAL, PATCHED copy (easy-api-patched.js, next
 * to this worker file), not the upstream CDN. Upstream's translateString()
 * passes the input/output buffer's BYTE length where liblouis's C API
 * expects a WIDECHAR (character) count, which on the UTF-32 build
 * overstates lengths by 4x and causes liblouis to read/write past the
 * actual buffer into adjacent WASM heap memory — producing corrupted
 * translations for some words depending on what's sitting in nearby
 * memory at call time. The compiled liblouis binary itself (`build`) is
 * unaffected and still comes straight from the CDN.
 */

const LIBLOUIS_SOURCES = [
  {
    build: "https://cdn.jsdelivr.net/gh/liblouis/js-build@master/build-no-tables-utf32.js",
    easyapi: "easy-api-patched.js",
    tables: "https://cdn.jsdelivr.net/gh/liblouis/js-build@master/tables/"
  },
  {
    build: "https://raw.githubusercontent.com/liblouis/js-build/master/build-no-tables-utf32.js",
    easyapi: "easy-api-patched.js",
    tables: "https://raw.githubusercontent.com/liblouis/js-build/master/tables/"
  }
];

// Same table chain the desktop pipeline uses: unicode.dis + en-ueb-g2.ctb
const LIBLOUIS_TABLE_LIST = "unicode.dis,en-ueb-g2.ctb";

let ready = false;
let initError = null;

// liblouis reports its own internal problems (unresolved table includes,
// compile failures, etc.) through this log callback rather than throwing —
// so a translateString() call can come back as a plain `null` with nothing
// in the returned value to explain why. Those messages normally only reach
// the worker's own devtools console, which is invisible without an
// inspector attached. Forwarding them to the main thread means they show up
// in the page's own #debug-log instead, no inspector needed.
function forwardLiblouisLog(level, msg) {
  self.postMessage({ log: true, level, msg });
}

function initLiblouis() {
  const errors = [];
  for (const source of LIBLOUIS_SOURCES) {
    try {
      importScripts(source.build);
      importScripts(source.easyapi);
      // `liblouis` is registered as a global by easy-api.js
      // eslint-disable-next-line no-undef
      liblouis.registerLogCallback(forwardLiblouisLog);
      // eslint-disable-next-line no-undef
      liblouis.enableOnDemandTableLoading(source.tables);
      ready = true;
      return;
    } catch (e) {
      errors.push((e && e.message) ? e.message : String(e));
    }
  }
  initError = errors.join(" | ");
}

initLiblouis();

self.onmessage = function (evt) {
  const data = evt.data || {};
  const id = data.id;
  const words = Array.isArray(data.words) ? data.words : [];

  if (!ready) {
    self.postMessage({ id, ok: false, error: initError || "liblouis failed to load" });
    return;
  }

  try {
    const results = words.map(function (word) {
      // eslint-disable-next-line no-undef
      const brl = liblouis.translateString(LIBLOUIS_TABLE_LIST, word);
      // Each translated braille cell is exactly one Unicode code point in
      // the U+2800-U+28FF block, so a code-point-aware length is the cell count.
      const cellCount = brl ? Array.from(brl).length : 0;
      if (!brl) {
        // translateString() itself failed for this word (returned null) --
        // distinct from a real translation that just isn't 5 cells. Almost
        // always caused by a table failing to load/compile; the actual
        // reason will have already come through forwardLiblouisLog above.
        forwardLiblouisLog("ERROR", "translateString returned null for: " + word);
      }
      return { word: word, brl: brl, cellCount: cellCount };
    });
    self.postMessage({ id, ok: true, results });
  } catch (e) {
    self.postMessage({ id, ok: false, error: (e && e.message) ? e.message : String(e) });
  }
};
