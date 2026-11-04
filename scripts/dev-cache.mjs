import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

/**
 * Keep the Turbopack dev cache and the production build output from poisoning
 * each other.
 *
 * Root cause of the "continuous reload" bug (2026-11-04):
 *   `next build`/`next start` and `next dev` share `.next`. The production build
 *   replaces the root manifests/build id and production commands can touch the
 *   shared cache, while Turbopack's incremental dev cache lives in `.next/dev`.
 *   Once dev is compiled and a production build (or a production server run)
 *   happens in the same tree, the dev cache no longer matches the build graph.
 *   The next `next dev` then:
 *     - compiles the route again on every document request,
 *     - bumps its internal HMR version after serving the document,
 *     - sends `{"type":"reloadPage","data":"HMR hash mismatch"}` when the browser
 *       subscribes with the older version,
 *   so the browser reloads forever and each reload recreates the mismatch.
 *
 * Rules (both are one-shot at command start, never a timer or retry):
 *   - `before-build` (npm `prebuild`): remove `.next/dev` before a production
 *     build so the build cannot leave stale dev state behind.
 *   - `prepare-dev` (npm `predev`): if a production build exists
 *     (`.next/BUILD_ID`), remove any dev cache before starting dev. A tree
 *     without production artifacts (pure dev workflow) keeps its incremental
 *     cache across restarts, so normal dev restarts stay fast.
 *
 * The script only manages the local `.next` build cache. It never touches
 * production output at runtime, `data/`, `.env`, source files or security code.
 */

const DEV_DIR = join(".next", "dev");
const BUILD_ID = join(".next", "BUILD_ID");

function removeDevCache(reason) {
  if (!existsSync(DEV_DIR)) {
    console.log(`[dev-cache] dev cache already absent (${reason})`);
    return;
  }
  rmSync(DEV_DIR, { recursive: true, force: true });
  console.log(`[dev-cache] removed stale Turbopack dev cache (${reason})`);
}

const mode = process.argv[2] ?? "prepare-dev";

if (mode === "before-build") {
  removeDevCache("starting production build");
  process.exit(0);
}

if (mode === "prepare-dev") {
  if (existsSync(BUILD_ID)) {
    removeDevCache("production build artifacts are present in .next");
  } else {
    console.log("[dev-cache] no production build present; keeping dev cache");
  }
  process.exit(0);
}

console.error(`[dev-cache] unknown mode: ${mode}`);
process.exit(1);
