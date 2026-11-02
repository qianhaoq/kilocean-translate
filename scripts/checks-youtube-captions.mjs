import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

export async function checkYouTubeCaptions(ROOT) {
  const utils = createRequire(import.meta.url)(`${ROOT}/shared.js`);
  for (const url of ["https://www.youtube.com/watch?v=IVx8OSMbTss", "https://youtube.com/watch?v=test"]) {
    assert.equal(utils.isYouTubeWatchUrl(url), true);
  }
  for (const url of ["https://notyoutube.com/watch?v=x", "https://youtube.com.evil.test/watch?v=x", "https://youtube.com/shorts/x", "https://youtube.com/watch", "garbage"]) {
    assert.equal(utils.isYouTubeWatchUrl(url), false);
  }
  const source = fs.readFileSync(`${ROOT}/content.js`, "utf8");
  const names = ["extendsCaptionUnit", "readYouTubeCaptions", "translateYouTubeCaption", "renderYouTubeCaptions", "stopYouTubeCaptions"];
  const functions = names.map((name) => source.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n  \\}`))[0]).join("\n");
  const startSource = source.match(/function startYouTubeCaptions\([\s\S]*?\n  \}/)[0];
  const hints = [];
  const noCc = vm.createContext({
    restoreOriginal: () => {}, location: { href: "https://www.youtube.com/watch?v=test" },
    document: { querySelector: () => ({ querySelector: () => null }) },
    showToast: (message) => hints.push(message)
  });
  vm.runInContext(startSource, noCc);
  noCc.startYouTubeCaptions({});
  assert.match(hints[0], /CC/, "no CC asks the user to enable captions without sending a request");
  const requests = [];
  const timers = new Map();
  let nextTimer = 0;
  let visibleText = "Hello";
  const cache = new Map();
  const overlay = { textContent: "", hidden: true, remove() { this.removed = true; } };
  const session = {
    player: { querySelector: () => ({ getAttribute: () => "true" }), querySelectorAll: () => [{ textContent: visibleText, getClientRects: () => [1] }] },
    overlay, observer: { disconnect() {} }, settings: {}, runId: 1,
    text: "", translation: "", translationSource: "", ready: "", firstChange: 0, busy: false
  };
  const clock = { value: 1000 };
  const context = vm.createContext({
    Utils: utils, captionSession: session, state: { displayMode: "bilingual" },
    Date: { now: () => clock.value }, checkSpaNavigation: () => false, hasHiddenAncestor: () => false,
    setTimeout: (fn) => { timers.set(++nextTimer, fn); return nextTimer; },
    clearTimeout: (id) => timers.delete(id),
    getCachedTranslation: (text) => cache.get(text) ?? null,
    setCachedTranslation: (text, value) => cache.set(text, value),
    requestSegmentTranslations: (texts) => new Promise((resolve) => requests.push({ texts, resolve })),
    showToast: (message) => { throw new Error(message); }
  });
  vm.runInContext(functions, context);
  const read = () => context.readYouTubeCaptions(session);
  const fire = () => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach((fn) => fn()); };
  const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  read();
  visibleText = "Hello world.";
  read();
  assert.equal(timers.size, 1, "karaoke updates coalesce");
  fire();
  assert.deepEqual([...requests[0].texts], ["Hello world."]);
  visibleText = "Next sentence.";
  read(); fire();
  assert.equal(requests.length, 1, "only one caption request in flight");
  requests[0].resolve(["你好世界"]);
  await settle();
  assert.equal(session.translation, "", "old cue response cannot replace current cue");
  assert.equal(requests.length, 2, "newest stable cue follows the in-flight request");
  requests[1].resolve(["下一句"]);
  await settle();
  assert.equal(overlay.textContent, "Next sentence.\n下一句");
  context.state.displayMode = "translation-only";
  context.renderYouTubeCaptions();
  assert.equal(overlay.textContent, "下一句");
  context.state.displayMode = "original";
  context.renderYouTubeCaptions();
  assert.equal(overlay.hidden, true);
  visibleText = ""; read();
  assert.equal(session.translation, "", "caption disappearance clears stale translation");
  visibleText = "Hello world."; read(); fire(); await settle();
  assert.equal(requests.length, 2, "revisited cue uses LRU cache");
  visibleText = "Pending navigation."; read(); fire();
  context.stopYouTubeCaptions();
  requests[2].resolve(["过期"]); await settle();
  assert.equal(context.captionSession, null);
  assert.equal(overlay.removed, true, "stop removes fullscreen overlay and rejects late results");

  // Rolling cues + cached seeks under a controlled clock: words land every
  // 300 ms while the provider answers 400 ms after each request, so the
  // serialized queue is realistically busy the whole time.
  const rollingClock = { value: 1000 };
  const scheduled = new Map();
  let nextScheduled = 0;
  const schedule = (fn, delay) => { scheduled.set(++nextScheduled, { fn, due: rollingClock.value + delay }); return nextScheduled; };
  const sent = [];
  const rollingCache = new Map();
  const rollingOverlay = { textContent: "", hidden: true, remove() { this.removed = true; } };
  let liveText = "";
  const rollingSession = {
    player: { querySelector: () => ({ getAttribute: () => "true" }), querySelectorAll: () => [{ textContent: liveText, getClientRects: () => [1] }] },
    overlay: rollingOverlay, observer: { disconnect() {} }, settings: {}, runId: 2,
    text: "", translation: "", translationSource: "", ready: "", firstChange: 0, busy: false
  };
  const rollingContext = vm.createContext({
    Utils: utils, captionSession: rollingSession, state: { displayMode: "bilingual" },
    Date: { now: () => rollingClock.value }, checkSpaNavigation: () => false, hasHiddenAncestor: () => false,
    setTimeout: (fn, delay) => schedule(fn, Number(delay) || 0),
    clearTimeout: (id) => scheduled.delete(id),
    getCachedTranslation: (text) => rollingCache.get(text) ?? null,
    setCachedTranslation: (text, value) => rollingCache.set(text, value),
    requestSegmentTranslations: (texts) => {
      sent.push({ texts: [...texts], at: rollingClock.value });
      return new Promise((resolve) => schedule(() => resolve([`译（${texts[0]}）`]), 400));
    },
    showToast: (message) => { throw new Error(message); }
  });
  vm.runInContext(functions, rollingContext);
  const readRolling = () => rollingContext.readYouTubeCaptions(rollingSession);
  const settleRolling = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  const advance = (ms) => {
    const end = rollingClock.value + ms;
    for (;;) {
      let id = 0;
      let due = Infinity;
      for (const [key, timer] of scheduled) {
        if (timer.due <= end && timer.due < due) { id = key; due = timer.due; }
      }
      if (!id) break;
      rollingClock.value = due;
      const timer = scheduled.get(id);
      scheduled.delete(id);
      timer.fn();
    }
    rollingClock.value = end;
  };

  // Scenario 1: rolling cue with words every 300 ms, responses after 400 ms.
  liveText = "The quick brown";
  readRolling();
  advance(650); await settleRolling();
  assert.equal(sent.length, 1, "quiet gap requests the partial cue");
  assert.deepEqual(sent[0].texts, ["The quick brown"]);
  liveText = "The quick brown fox jumps";
  readRolling(); await settleRolling();
  advance(400); await settleRolling();
  assert.equal(
    rollingOverlay.textContent,
    "The quick brown fox jumps\n译（The quick brown）",
    "prefix translation renders while the cue keeps rolling"
  );
  liveText = "The quick brown fox jumps over";
  readRolling(); await settleRolling();
  assert.equal(
    rollingSession.translation, "译（The quick brown）",
    "rolling word tick keeps the shown translation"
  );
  advance(650); await settleRolling();
  assert.equal(sent.length, 2, "rolling cue still sends a fresh request for the longer text");
  assert.deepEqual(sent[1].texts, ["The quick brown fox jumps over"]);
  advance(400); await settleRolling();
  assert.equal(
    rollingOverlay.textContent,
    "The quick brown fox jumps over\n译（The quick brown fox jumps over）",
    "longer translation replaces the prefix one without regress"
  );
  liveText = "The quick brown fox jumps over the lazy dog.";
  readRolling(); await settleRolling();
  assert.equal(
    rollingSession.translation, "译（The quick brown fox jumps over）",
    "final word tick still keeps the previous translation"
  );
  advance(250); await settleRolling();
  assert.equal(sent.length, 3, "punctuated final cue requests after the short debounce");
  assert.deepEqual(sent[2].texts, ["The quick brown fox jumps over the lazy dog."]);
  advance(400); await settleRolling();
  assert.equal(
    rollingOverlay.textContent,
    "The quick brown fox jumps over the lazy dog.\n译（The quick brown fox jumps over the lazy dog.）",
    "final translation is displayed"
  );

  // Scenario 2: seeking back to a cached cue while a request is busy.
  liveText = "A completely different sentence.";
  readRolling();
  advance(250); await settleRolling();
  assert.equal(sent.length, 4, "new cue requests while nothing is cached");
  liveText = "The quick brown";
  readRolling(); await settleRolling();
  assert.equal(
    rollingOverlay.textContent,
    "The quick brown\n译（The quick brown）",
    "cached cue renders immediately while busy"
  );
  assert.equal(sent.length, 4, "cached seek sends no new request");
  advance(400); await settleRolling();
  assert.equal(
    rollingOverlay.textContent,
    "The quick brown\n译（The quick brown）",
    "unrelated late response cannot replace the cached seek"
  );
  assert.equal(rollingCache.has("A completely different sentence."), true, "unrelated cue still warms the LRU");
  advance(1000); await settleRolling();
  assert.equal(sent.length, 4, "cached seek never re-requests afterwards");
}
