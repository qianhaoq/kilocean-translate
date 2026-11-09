# Manga MVP fixtures and Node-only validation

All four supplied images are original synthetic fixtures, not user screenshots or scraped manga:

- `sample-page-ja.png`: two white speech bubbles and a lower stick figure.
- `fixture-vertical-ja.png`: vertical Japanese text.
- `fixture-small-dual-ja.png`: two smaller text bubbles.
- `fixture-complex-bg-ja.png`: white bubbles over a complex background.
- `index.html`: local fixture gallery.

## Required keyless gate

```sh
node scripts/ci-check.mjs
```

No browser, canvas dependency, credentials or API calls are needed. The fixture PNG is decoded with Node/zlib for a production-renderer regression: top bbox `[82,103,260,152]` has perfectly white perimeter but interior below 88%; expansion must rescue it so both bubbles paint. Tests also cover symmetric overlap rejection before writes, visible skip/zero-result notes, selective ink erase/art preservation, refcounted capture hides, secure-worker hashing of long HTTP layouts, navigation invalidation, privacy/consent, stale replies and bounded success-only caching.

## Explicit live probe / offline replay (Node + canvas)

Canvas is installed outside the repo at `/tmp/manga-node-canvas/node_modules/canvas`.

```sh
# Opt-in: one DeepSeek call per supplied fixture, four maximum, no retries.
RUN_MANGA_LIVE=1 node scripts/manga-live-probe.mjs

# Default: replay existing JSON responses with zero API calls and no key read.
node scripts/manga-live-probe.mjs
```

Only the opt-in path reads `/home/box/.secrets/deepseek_api_key`; the key is never printed. The script calls the real worker handler with fixture PNGs and renders using production `mangaDraw`. Responses, review PNGs and a report go to `/workspace/kt-manga-review/`, outside this worktree and commits. The sample asserts exactly two painted bubbles and pixel-for-pixel preservation of the lower art band, including a positive dark-pixel mass. Printed results include painted/skipped counts. No retries are made for OCR misses.

`out-before.png` and `out-after.png` show the current supplied sample and the Node-rendered live-response replay. They are renderer evidence for this fixture, not a guarantee of reader or OCR compatibility.

The older `scripts/manga-browser-check.mjs` is a **legacy, unrun browser harness**. It is not part of this gate, is not current validation evidence, and must not be used for this Node-only task. No Playwright or CDP was run for this pass.

## Try the extension

Load the root unpacked, configure a DeepSeek key, then use **更多 → 框选翻译漫画（DeepSeek）**. Drag a visible region, review the local crop and confirm **翻译选区**. Cancel/Escape sends no image. Switch **原图 / 译图** without another request; download is under **更多**. Existing text/YouTube translation remains separate.

## Safety and limits

- Confidence stays >=0.9. Region validation requires >=88% near-white overall, >=88% near-white interior and >=90% near-white two-pixel perimeter. Clamped 2–8px expansion must pass all the same thresholds; the perimeter need not strictly improve if already white.
- Only grayscale ink marks backed by local white are erased; no whole-box fill. Colored pixels, near-white background, long outlines, clipped corners and dense patches are preserved. All overlapping boxes are rejected before any painting. Model uncertainty and these heuristics still limit art/OCR accuracy.
- The UI shows painted/reported totals and a preservation note for skipped regions. With zero replacements it keeps the full original and displays degradation. OCR omissions cannot be counted if the provider reports no box for missing text.
- Scroll events, including overflow-reader scrolls (capture phase), resize and detectable navigation clear the overlay. Worker URL notifications cover detectable pushState/replaceState URL changes. Same-URL internal page flips cannot reliably be detected; Jump+, reader zoom and page-turn compatibility remain limited. Retrigger after flipping.
- Long URL/layout identities and cropped-image hashes are computed in the secure worker, so HTTP pages do not depend on content-world `crypto.subtle`. Only a bounded layout digest accompanies translation. Local stale checks retain the full identity.
- Capture hides are reference-counted across overlapping requests. Cache capacity remains eight OCR responses, keyed by crop/layout/language; failures, aborts and all-uncertain OCR are not cached. Worker restart clears it.
- Only the visible confirmed crop is uploaded; no chapter scraping. Max 16 megapixels / roughly 12 MB PNG crop; 60-second request deadline. Permissions/hosts/version are unchanged, with no installed content scripts or generative artwork requests.
