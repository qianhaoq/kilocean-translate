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
  const names = ["readYouTubeCaptions", "translateYouTubeCaption", "renderYouTubeCaptions", "stopYouTubeCaptions"];
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
    text: "", translation: "", ready: "", firstChange: 0, busy: false
  };
  const context = vm.createContext({
    Utils: utils, captionSession: session, state: { displayMode: "bilingual" },
    Date, checkSpaNavigation: () => false, hasHiddenAncestor: () => false,
    setTimeout: (fn) => { timers.set(++nextTimer, fn); return nextTimer; },
    clearTimeout: (id) => timers.delete(id),
    getCachedTranslation: (text) => cache.get(text),
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
}
