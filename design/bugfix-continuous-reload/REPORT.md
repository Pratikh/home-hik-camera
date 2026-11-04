# Bugfix report — Home CCTV Hub continuous reload

**Branch:** `bugfix/continuous-reload` (created from `security/immediate-hardening` @ `f3ddcb3`)
**Date:** 2026-11-04 · **Scope:** diagnosis + minimal fix. No commit was made (see §9).

---

## 1. Root cause

**A shared build directory between production builds and Turbopack's development server.**

`next build` and `next dev` both use `.next`. In Next.js 16 (Turbopack), the development incremental cache lives in `.next/dev`. Running a production build after dev has compiled routes replaces the production-side manifests/build id in `.next`, but leaves `.next/dev` behind in a state that no longer matches the server graph. The next `next dev` start then:

1. serves each document with the HMR version/chunk references from the stale dev cache;
2. recompiles the route on every request (server log: **125 `✓ Compiled` lines for 138 `GET /` requests**);
3. increments the server-side HMR version after the HTML was generated, so the client's subscription carries an old version;
4. the dev server answers with `{"type":"reloadPage","data":"HMR hash mismatch"}` (`node_modules/next/dist/server/dev/hot-reloader-turbopack.js:1334–1339`);
5. the Turbopack client applies that message via `restart()` → **full page reload**;

and the reload immediately recreates the mismatch, so the browser reloads forever.

**It is not CSP, authentication, cookies or the proxy.** Evidence:

- Unauthenticated `/login` looped too (137 document loads / 10 s) — no session involved.
- The development CSP is `script-src 'self' 'unsafe-inline' 'unsafe-eval'` (no nonce) and produced **0 CSP violations / 0 console errors**.
- A tampered session cookie terminates correctly at `/login` (one redirect hop + one page load, no loop).
- The production server (nonce CSP, `strict-dynamic`) is stable: 0 CSP violations, 0 console errors, no reloads.
- **Deleting only `.next/dev` (keeping the production `.next`) stopped the loop** — proving the stale dev cache is the corrupt artifact.

**Why it appeared after the security-hardening branch:** that branch's verification workflow runs production builds (`npm run build` for the container image and the Phase 4 browser check) in the same checkout where `npm run dev` is used. The hardening commits also rewrote `next.config.ts`/`proxy.ts`, causing dev-server restarts while a dev cache existed. The collision is a build/dev lifecycle bug; the security code itself is correct.

---

## 2. Exact file / code responsible

- No application source line was wrong. The collision is between the two Next.js commands sharing `.next`:
  - `next build` → `.next` (production manifests + `BUILD_ID`)
  - `next dev` (Turbopack) → `.next/dev` (incremental cache, not removed by the build)
- The reload is emitted by Next's own hot reloader: `node_modules/next/dist/server/dev/hot-reloader-turbopack.js` (HMR-version check at the `turbopack-subscribe` handler, lines ~1334–1339). We do not patch vendored framework code.
- The fix therefore lives at the project's build/dev workflow boundary (npm scripts), where the two commands are defined (`package.json`).

---

## 3. Why the continuous reload occurred

Each document load was treated as a new dev compilation because the dev incremental cache was invalid for the current build graph. A new compilation bumps `clientHmrVersion`; the browser had subscribed with the previous version, so the server ordered a hard reload. The page reload caused the next compilation and the next version bump — a self-sustaining loop. It survives dev-server restarts because the stale cache is on disk.

---

## 4. Files changed

| File | Change |
|---|---|
| `scripts/dev-cache.mjs` | **New.** Cache-lifecycle helper: `before-build` clears `.next/dev`; `prepare-dev` clears any dev cache whenever production build artifacts are present. |
| `package.json` | Added `"predev": "node scripts/dev-cache.mjs prepare-dev"` and `"prebuild": "node scripts/dev-cache.mjs before-build"` (2 lines). |
| `design/bugfix-continuous-reload/REPORT.md` | This report. |
| `design/bugfix-continuous-reload/evidence/` | Reproduction logs, HMR/network evidence, browser-verification JSON. |

No changes to `src/`, `next.config.ts`, `proxy.ts`, auth/session code, CSP, cookies, MediaMTX, DVR, workers, database or `.env`.
(The working tree still contains the previously approved Sentinel UI redesign, uncommitted and unrelated to this fix; it was not modified by this task.)

---

## 5. Exact fix

```jsonc
// package.json
"predev":   "node scripts/dev-cache.mjs prepare-dev",
"dev":      "next dev --hostname 0.0.0.0 --port 3000",
"prebuild": "node scripts/dev-cache.mjs before-build",
"build":    "next build",
```

`scripts/dev-cache.mjs`:

- **`before-build`** — before every `npm run build`, delete `.next/dev`, so the production build can never leave a dev cache built against the old graph.
- **`prepare-dev`** — before every `npm run dev`, if a production build exists (`.next/BUILD_ID`), delete any dev cache. In a pure dev workflow (no production build ever) the incremental cache is kept across restarts, so normal dev restarts stay fast. This rule also self-heals a tree that was built with `npx next build` directly (bypassing the npm hook): the next `npm run dev` clears the stale cache automatically.

A stamp-based optimisation was tested first and rejected: a concurrent production-server run in the same tree could invalidate the dev cache without changing `BUILD_ID`, so the "only if the build is newer than the stamp" rule missed it. The deterministic rule above was verified against that scenario.

This is a cache-lifecycle fix, not a reload workaround: there is no polling, timer, retry or page-level reload code, and it only runs when the dev/build commands start. Security hardening is untouched; `.next/dev` is a local dev artifact, never part of the production image or runtime.

---

## 6. Tests performed and results

| Gate | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` | ✅ pass |
| ESLint | `npm run lint` | ✅ 0 errors (8 pre-existing warnings, none introduced) |
| Unit/integration | `npm test` | ✅ **82 files / 837 tests passed** |
| Production build | `npm run build` | ✅ pass; prebuild removed dev cache, `.next/dev` absent after build |
| E2E | `npx playwright test --workers=1` | ✅ **101 passed, 10 skipped, 0 failed** on the first clean run after the fix (same documented skips: 8 VIEWER cases without credentials, 2 mutation-gated rule cases). Later reruns during heavy QA produced 1 playback-only failure (see limitation 5): all non-playback cases stayed green. |
| Deterministic reproduction | clean → dev (compile all 14 routes) → stop → build → dev | ✅ previously **138 document loads / 12 s**; after fix **1 document load / 20 s** |
| Sustained idle | dashboard observed for 60 s | ✅ 1 total document load (the initial navigation), 0 compiles, 0 console errors |
| Route sweep | 14 authenticated routes, 2.5 s each | ✅ exactly 1 document load per route, correct `<h1>`, 0 horizontal overflow |
| Self-heal | direct `npx next build` (bypassing `prebuild`) then `npm run dev` | ✅ predev logged removal of the stale cache; stable (1 load / 15 s) |
| Restart loop | stop/start `npm run dev` twice with production artifacts present | ✅ each start removed the dev cache; 1 document load / 12 s per run |
| Concurrent prod+dev | `next start` alongside dev, then restart dev | ✅ predev reconciled on restart; stable (1 load / 20 s) |
| Production mode | `next start` + Playwright | ✅ nonce CSP active and matching, login works, 0 CSP violations, 0 console errors, 0 reloads |
| Auth | login / logout / tampered cookie | ✅ login 200 (HttpOnly, SameSite=Lax, 7-day Max-Age, Secure as configured), logout → `/login` with session 401, tampered cookie → `/login` and stays |

Raw results: [`evidence/pre-fix-evidence.json`](evidence/pre-fix-evidence.json), [`evidence/postfix-summary.json`](evidence/postfix-summary.json), [`evidence/post-fix-browser-verify.json`](evidence/post-fix-browser-verify.json), server logs in [`evidence/`](evidence/).

## 7. Browser verification evidence

- **Before (reproduced):** 138 document requests / 274 navigations in 12 s; HMR socket frames showed `{"type":"building"}` followed by `{"type":"reloadPage","data":"HMR hash mismatch"}`; reload initiator stack was Turbopack's `handleApply → restart` (CDP initiator capture); server log had one compile per request (`evidence/dev-loop-server.log`, `evidence/pre-fix-evidence.json`).
- **After:** 1 document request over 60 s idle; no HMR reload frames; no console/page errors; all 14 routes settle with a single document load; production browser shows 0 CSP violations and 0 console errors (`evidence/postfix-*.log`, `evidence/postfix-production-browser-verify.json`).
- **Targeted reproduction commands/tools kept in the repo:** `design/tools/reload-repro.mjs` (document-load/reload counter with HMR + console capture), `design/tools/bugfix-verify.mjs` (route/idle/logout/cookie sweep), `design/tools/prod-verify.mjs` (production CSP + stability).

## 8. Security hardening remains intact

- CSP unchanged: development keeps `'unsafe-inline' 'unsafe-eval'` (Turbopack HMR requirement); production still sends `script-src 'self' 'nonce-…' 'strict-dynamic'` with a fresh nonce, `object-src 'none'`, `base-uri/form-action/frame-ancestors` restrictions. Verified same-request header/HTML nonce match and zero CSP violations.
- Auth/session and proxy files untouched: cookie flags, session validation, throttling, trusted-peer handling and admin guards unchanged.
- No `unsafe-inline` was added to production, no authentication disabled, no rate limiting removed, no MediaMTX/DVR/worker changes.
- `security/immediate-hardening` branch untouched; `main` untouched.

## 9. Branch and commit state

- `bugfix/continuous-reload` created from `security/immediate-hardening` (`f3ddcb3`); `security/immediate-hardening` and `main` remain unchanged.
- **No commit was made.** Per the task rules, the diff is left for review. The fix is 2 lines in `package.json` + one new script (+ evidence/report docs). The earlier approved UI redesign remains uncommitted in the same working tree and is unrelated.

## 10. Remaining limitations

1. **VIEWER role redirects were not re-verified** — this workspace has no viewer credentials; that behaviour is unchanged and the ADMIN/unauthorized suites pass.
2. Direct `next dev` / `next build` invocations bypass the npm hooks. If a build directly follows a dev session, the next **`npm run dev`** self-heals (verified), but running `npx next dev` directly would need `rm -rf .next/dev` manually. A future hardening could enforce separate `distDir` values (rejected here: it would churn generated type paths; the npm workflow is the documented entry point).
3. Do not run a production build while `npm run dev` is active: `prebuild` intentionally removes the running dev cache. Stop dev before building (already the documented workflow).
4. Dev cache cleanup is intentionally not applied to production images or runtime; `.next/dev` never ships.
5. **Playback QA flake (pre-existing environment constraint, not the reload fix):** the DVR serves a single playback stream. During repeated QA runs a hung Telegram-clip `ffmpeg` held that slot (MediaMTX logged `453 Not Enough Bandwidth`), and the thumbnail preview generator also competes for it; with a partially cold preview cache, `PLAY-016`/`PLAY-018` can fail while every other test stays green. `PLAY-016` passes standalone (4.2 s) once the slot is free, and the first clean full suite after the fix passed all 19 playback cases. The reload fix touches no playback, streaming, DVR or thumbnail code.
6. QA process notes: the dev server was run with `TELEGRAM_NOTIFICATIONS_ENABLED=false` to avoid sending real messages, and the thumbnail worker was toggled in one experiment only (process env, no config change). `.env` and application code were not modified. An orphaned `ffmpeg` from a normal-mode dev session was terminated during diagnosis; it had no parent process left.
