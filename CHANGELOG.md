# Changelog

All notable changes to the Trackless Telemetry Web SDK will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0] - 2026-11-04

### Added

- **Timers: `startTimer(name)`, `stopTimer(name, thresholdSeconds?)` and `cancelTimer(name)`.** `stopTimer` sends the elapsed time as a performance measurement, exactly as `performance(name, durationSeconds, thresholdSeconds?)` would; `cancelTimer` drops the timer and sends nothing. The name is normalized at start, so `stopTimer("Checkout")` closes `startTimer("checkout")`, and a name normalization rejects is ignored with the usual warning. A stop with no open timer does nothing, and starting an open name restarts it. At most 50 timers are open at once; a start past that is ignored with one warning per session.
- **`measure(name, fn, thresholdSeconds?)`** returns what `fn` returns. When `fn` returns a promise, the measurement runs until it settles and `measure` returns a promise of the same value. The measurement is sent only when `fn` returns or its promise resolves; a throw or a rejection reaches the caller unchanged and nothing is sent.
- **Session end discards every open timer** (the page becoming hidden), as do `setEnabled(false)`, a `configure()` with changed settings and `destroy()`, so a timer never measures time the tab spent hidden. A `measure` whose promise was pending when the session ended sends nothing.
- Timers read `performance.now()`. An elapsed time below zero or above a day is dropped with a warning. Open timers live in memory only — no cookies, `localStorage`, `sessionStorage` or IndexedDB.
- **`measureLaunch?: boolean` and `launchThresholdSeconds?: number`** on `TracklessConfig`. When on, the SDK sends the performance metric `trackless.launch` once per page load: seconds from navigation start to the `load` event, from the page's `PerformanceNavigationTiming` entry (`loadEventStart`), with `launchThresholdSeconds` as its threshold when set. If `load` already fired at `configure()`, the entry is read at once. Soft navigations are not launches; a launch measured while recording is disabled is not sent; a launch longer than 60 seconds, negative or not a finite number is dropped, not clipped. A page that did not load in front of the user sends no launch time: a prerendered page (`document.prerendering` at `configure()`, or an `activationStart` after zero), and a page hidden at any time before `load` — any `hidden` `visibility-state` entry at or before `loadEventStart` where the browser records them (Chromium), otherwise a page hidden at `configure()` or one that goes hidden between `configure()` and `load`. A `configure()` after `load` in a browser without those entries cannot see an earlier hidden period, so that launch is still sent. Everything is read in memory. A threshold that is not a positive number is ignored, with a warning.
- **`detectHangs?: boolean`** on `TracklessConfig`. When on, a `PerformanceObserver` on `longtask` entries (`buffered: false`) sends each long task of 250 ms or more as one `trackless.hang` sample, in seconds, with no threshold. It runs only while the page is visible. The `longtask` entry type exists only in Chromium-based browsers; elsewhere it does nothing, silently.
- Both options are **off by default**. Changing either in a repeat `configure()` counts as changed settings. Neither SDK metric counts toward the session's depth.
- **The `trackless.` prefix is reserved** for what the SDK sends itself. `performance()`, `startTimer()`, `measure()`, `error()` and `info()` log a warning once per page load when given a name with that prefix, and still send it. The SDK's own sends never warn.
- **`captureUncaught?: boolean`** on `TracklessConfig`. When on, listeners on `window` `error` and `unhandledrejection` record each uncaught error through the normal error path as `error("trackless.uncaught", <name>)`: the error's `name`, normalized (`typeerror`), or `non_error` for a thrown or rejected value that is not an `Error`; `unknown` if normalization rejects the name. Skipped, compared in memory and never sent: an `error` event with no error object (an opaque cross-origin "Script error.") and one whose `filename` is a browser-extension script (`chrome-extension:`, `moz-extension:`, `safari-extension:`, `safari-web-extension:`). Only the name is read — never the message, stack, file name or line — and the listeners never call `preventDefault()`, so the browser still logs the error. They are added on `configure()` and removed by `setEnabled(false)`, a changed `configure()` and `destroy()`. Off by default; changing it in a repeat `configure()` counts as changed settings. An uncaught error does not count toward the session's depth.

### Changed

- **Automatic view tracking sends only a plain anchor from the URL hash.** The whole hash used to become the view's `detail`, so an OAuth implicit-flow redirect (`#access_token=ya29...&token_type=Bearer`) sent its token, and so did a share key or a recovery link. A hash now becomes `detail` only as lowercase words of 1-20 letters with up to 3 trailing digits, joined by one `-` or `_`, where a word after the first may be a number of up to 4 digits, at 64 characters or fewer: `#pricing` and `#section-12` still do. Anything else is left out and the view still counts on its bare name. That includes hash-router paths (`#/settings/profile`) and camelCase anchors (`#getStarted`), which used to arrive as a detail. A left-out hash shares the bare name's 60-second cooldown, so a hash-router app now counts at most one view per path in that window, where each route used to count; send those yourself with `view(name, detail)`. A secret that fits the shape, such as a passphrase or a short code like `abc123`, still passes.

### Fixed

- **A UUID or long hex ID in an event field is now rejected.** The PII strip ran before the identifier checks, and its phone pattern eats runs of digits, so `123e4567-e89b-12d3-a456-426614174000` could go out as `123e4567-e89b-12d3-a_redacted`, which no check matched. The checks now run on the value before the strip as well as after it, and before truncating. They also find a UUID or a run of 24 or more hex characters anywhere in the value, so `user-<uuid>` and `tok_<24 hex characters>` are rejected like a bare one, as is a UUID with dots or doubled separators between its groups or with its tail cut off. A value holding `redacted` beside 8 or more characters of hex-only tokens is rejected as what remains of an ID. A rejected `name` or funnel `step` drops its event with the usual warning; a rejected `detail` or `code` is left out and the event is still sent.
- **A field cut at 100 characters no longer ends in `.`.** Ingest rejected that value along with every other event in its batch.
- **Automatic view tracking counts a page whose URL segment holds an embedded ID.** `/users/user-<uuid>/profile` is sent as `users_-id-_profile`.
- **An email holding a non-ASCII character is now redacted whole.** The pattern read only ASCII, so `josé@example.com` went out as `jos_example.com`, `user@exämple.com` as `user_ex_mple.com` and `日本語@example.com` as `example.com`. All of these are now sent as `redacted`. A Unicode space still ends an address, but ASCII text joined to one by other non-ASCII characters goes with it: `login失敗user@example.com` is sent as `redacted`. The Swift and Android SDKs now give the same results.
- **An email followed directly by a letter, digit or `_` is now redacted.** `user@example.com_x` went out whole as `user_example.com_x`, and is now sent as `redacted__x`. A local part longer than 64 characters keeps what comes before its last 64.
- **The SSN and phone patterns match what they matched before on the web.** They now spell out `[0-9]` and the phone separators instead of `\d` and `\s`, so all three SDKs read them alike.

## [0.5.1] - 2026-10-14

### Fixed

- **A second `configure()` no longer loses buffered events.** Calling `configure()` again with a different setting — a new API key when the user switches organization, say — replaced the event buffer without flushing it, so events recorded under the previous key were dropped. The current session's end is now added to the old buffer and that buffer is sent under the previous key, endpoint, environment and context before the new configuration starts its own session.
- **The previous session now ends on reconfigure.** It used to be left with a start and no end; its `end` event, with duration and depth, now goes out under the previous key.
- **A flush in flight when the key changes finishes under the key it started with.** A flush split into several requests read the key, endpoint and environment as each request went out, so a `configure()` landing between them could send the remaining requests under the new key.
- **A changed `flushIntervalSeconds` or `autoScreenTracking` takes effect on reconfigure.** The old flush timer kept running at the old interval, and turning `autoScreenTracking` off left the `popstate` / `hashchange` listeners and the `history.pushState` hook in place. Both are now torn down and reinstalled from the new settings.
- **A repeat `configure()` with identical settings keeps the current session.** SPA code that re-runs `configure()` on route mount started a new session on every call, inflating session counts. It now only replaces `onError` and logs `configure — settings unchanged, keeping the current session` under `debugLogging`.
- **An opt-out no longer leads to a later send.** `setEnabled(false)` discarded the buffer but left the session open, so a later `destroy()` (or page hide) still sent that session's end. It now drops the session without sending anything, and `setEnabled(true)` starts a new session.

## [0.5.0] - 2026-09-18

### Added

- **`info(name, detail?)`** — records something worth counting that the user did not do and that did not go wrong: a tier, a unit preference, a theme, a notification permission state, a fallback path that fired. It is sugar over the existing error path — same normalization, PII guard, session-reach marker, session-depth increment and client-side rollup — sent with severity `info` and the detail in `code`. An info event never counts toward errors per session and never triggers an alert. Called once per session, each value's count equals the number of sessions that reported it; it counts sessions, not people.
- **`error(name, code?)`** — the documented error signature. The second argument is now the code, so `error("api_timeout", "TIMEOUT_500")` reads the way it looks.

### Changed

- **`environment` defaults to `sandbox` on localhost / loopback hosts when not configured.** With no `environment` in the config, a page served from `localhost`, any `*.localhost`, a `127.x.x.x` address, `[::1]` or `0.0.0.0` now sends `"sandbox"`; every other host still sends `"production"`. An explicit value always wins, including `"production"` on localhost. LAN and private IPs, `.local` and `.test` hosts, staging, preview deploys, and Electron or other `file:` pages are not treated as local — set `environment` explicitly there. The hostname is compared in memory only and never sent or stored.
- **Two stored levels.** The SDK maps whatever severity a caller passes to one of two values before the event is buffered: `error`, `warning` and `fatal` are sent as `error`; `info` and `debug` are sent as `info`. Nothing downstream ever read `fatal` or `warning` differently from `error`, so the five levels bought a sort order and two donuts and cost developers their own error rate. The ingest endpoint applies the same mapping, so an older SDK build is handled identically. One consequence to expect: a name previously reported at several severities in one flush window now rolls up into a single buffered entry instead of one per level.
- **The `severity` parameter on `error()` is deprecated** — marked `@deprecated` in the type declarations, not removed, so no published call breaks. The `Severity` constants stay exported, with `DEBUG`, `INFO`, `WARNING` and `FATAL` individually deprecated (`ERROR` and `INFO` are the two levels the wire still carries). Replace `error(name, Severity.WARNING, code)` with `error(name, code)`, and `error(name, Severity.INFO, value)` with `info(name, value)`.
- **An unrecognized second argument is now the code, not an invalid severity.** `error()`'s runtime severity check (added in 0.3.0 for plain-JavaScript callers) is gone with the parameter it guarded: any second argument that is not one of the five severity strings is recorded as the code, and no warning is logged. `error(name, "TIMEOUT_500")` was previously a fallback-to-`error` plus a console warning; it now records `code: "timeout_500"`.

### Removed

- **`distributionChannel` (page hostname) is no longer sent.** It carried `window.location.hostname`, an open-ended value — every per-tenant subdomain, preview deployment and staging alias became its own dimension value. The SDK no longer includes it in the context; ingest accepts and discards it from older SDK builds.

### Documentation

- The five-level severity table is gone from README.md, GUIDE.md, AGENTS.md and .cursorrules, replaced by the two methods and a migration note carrying the mapping. New guidance: do not share a name between `error()` and `info()` — they share one store and one session-reach marker.
- The feature example leads with `feature("export", "csv")` rather than `feature("export_clicked")`: name the feature, put the variant in `detail`. Names are permanent once data exists.
- Session depth has one definition everywhere — **events per session**, incremented by every non-session event including `info()`.
- The `distributionChannel` row and note are gone from README.md's context table, and GUIDE.md's collected-context sentence no longer lists it. The `EventContext` type documents `distributionChannel` and `daysSinceInstall` as sent only by SDK versions before 0.5.0 and discarded at ingest. README.md, GUIDE.md (§0 and the options table), AGENTS.md and .cursorrules describe the new `environment` default and the hosts it does not cover.

## [0.4.1] - 2026-08-26

### Added

- **AGENTS.md** — a README for coding agents, following the [agents.md](https://agents.md) convention: the critical integration rules, the exact public API surface, naming and environment rules in brief, and a pointer to GUIDE.md as the authoritative guide. Shipped in the npm tarball alongside GUIDE.md and .cursorrules.
- **Verification and troubleshooting documentation** — GUIDE.md gains a "Verify the Integration" section (the exact `[Trackless]` console signal strings an agent can check unattended, ending at `flush success — status=200`, plus the dashboard's "See your first feature data" checklist confirmation) and a troubleshooting table decoding the ingest endpoint's deliberately generic responses (401 wrong/regenerated key, 402 quota reached, 429 rate limit, 5xx/network with the circuit breaker's actual behavior — failed batches are not re-sent; backoff only pauses future flushes, 30s → 60m). AGENTS.md gains a matching compact "Verify" block.
- **Anti-interpolation rule documented** — event fields must come from finite sets enumerable at write time; never interpolate runtime values (``feature(`export_${format}`)`` is the failure mode). Stated as a fourth critical rule in AGENTS.md and a subsection under GUIDE.md's event-naming rules, including the per-app daily cardinality budget that drops new `(type, name, detail)` tuples beyond it.
- **.cursorrules completes the critical rules** — now states the no-wrapper rule and the detail-is-a-separate-argument rule alongside the existing guidance.

### Changed

- **`destroy()` guidance corrected** — entry-point (`main.ts`) setups need no `destroy()`; the cleanup advice applies only to effect-mounted setups (e.g., the Next.js app-router `useEffect` pattern), and `configure()` after `destroy()` re-initializes, so React 18 StrictMode double-mounts are safe. GUIDE.md's complete integration example now configures inline in `main.tsx` instead of through an `analytics.ts` indirection the no-wrapper rule prohibits. README now describes both Next.js routers accurately, shows `error()`'s severity default, and — with GUIDE.md and AGENTS.md — notes that the API key is obtained from the dashboard (shown once at creation) and that hardcoded `appVersion` examples must be replaced with the host app's real version.

### Fixed

- **Name-rejection warnings no longer echo raw caller input** — when an event name fails normalization, the console warning and the `Error` passed to `onError` now omit the name entirely and explain why it was rejected. Previously both carried the raw, pre-normalization string; the `onError` case is the more exposed of the two, since host apps routinely forward that callback to a crash reporter. No telemetry was ever affected: nothing here is buffered or transmitted, and PII stripping still runs before any event reaches the wire.

## [0.4.0] - 2026-08-21

### Added

- **Error session reach** — `error()` now marks the first occurrence of each error within a session by sending `firstOccurrences: 1` on that first event only, powering session-reach analytics (the share of sessions that hit an error at least once) in the dashboard. Mirrors the existing `firstUses` marker for features. Deduplication is by normalized error name only (not `name + severity + code`), so a session reporting one error at several severities counts once toward reach. The first-occurrence set is in-memory, resets on session end (like funnel and feature-reach state), and survives mid-session flushes; client-side rollup sums `firstOccurrences` per key. No code changes required and no new data is stored client-side.

## [0.3.0] - 2026-07-21

### Added

- **Runtime severity validation** — `error()` now validates the severity value at runtime for plain-JavaScript callers. Invalid values fall back to the default `"error"` with a console warning (respects `suppressWarnings`). TypeScript callers were already constrained by the `ErrorSeverity` union.
- **Feature session reach** — `feature()` now marks the first use of each feature within a session by sending `firstUses: 1` on that first event only, powering session-reach analytics (the share of sessions that use a feature at least once) in the dashboard. Deduplication is by normalized feature name only (not `name + detail`), so a session using several variants counts once toward reach. The first-use set is in-memory, resets on session end (like funnel state), and survives mid-session flushes; client-side rollup sums `firstUses` per key. No code changes required and no new data is stored client-side.

### Fixed

- **Request body size limit** — flush now checks each serialized payload against the ingest endpoint's 50 KB body limit. Oversized payloads are split in half recursively until each request fits; a single event that exceeds the limit on its own is dropped with a console warning. Previously oversized batches were rejected server-side and the whole batch was lost.
- **Buffer-full visibility** — when the event buffer reaches its 1000-item cap and starts rejecting new events, the SDK now emits a console warning (at most once per session, respects `suppressWarnings`) instead of dropping data silently.
- **Pre-configure visibility** — event methods called before `configure()` now emit a one-time console warning (respects `suppressWarnings`) instead of dropping events silently.

## [0.2.5] - 2026-04-16

### Added

- **Distribution channel detection** — new `distributionChannel` context field captures `window.location.hostname` (e.g., `"www.example.com"`, `"blog.example.com"`), enabling filtering and grouping by source hostname in the dashboard.

### Fixed

- **Dynamic URL segment stripping** — auto screen tracking now strips UUIDs, long numeric IDs, and hex strings from URL path segments (e.g., `/apps/a1b2c3d4-.../sessions` becomes `/apps/-id-/sessions`), preventing high-cardinality view names from consuming cardinality budget.

## [0.2.4] - 2026-03-25

### Fixed

- Fix TypeScript declaration output path — add explicit `rootDir: "src"` to tsconfig so `.d.ts` files emit to `dist/` instead of `dist/src/`, matching the `types` field in package.json

## [0.2.3] - 2026-03-24

### Added

- **Bot detection** — Automation-driven browsers (Selenium, Puppeteer, Playwright) are now reported as `browser: "bot"` via the W3C `navigator.webdriver` flag. This lets dashboard users see if traffic is coming from bots without violating any privacy invariants.
- Include SDK version (`web/0.2.3`) in event context for server-side diagnostics
- Add `language` to event context — ISO 639-1 code detected from `navigator.language`

### Changed

- **Privacy guarantees clarified** — explicitly documents that error tracking collects no stack traces, crash logs, or error messages, and that performance tracking stores no individual duration measurements (server-side t-digest aggregation only).

## [0.2.2] - 2026-03-23

### Fixed

- **iOS misidentified as macOS** — Safari on iPhone/iPad was reported as `os: "macos"` because the UA string contains "like Mac OS X" and the macOS check ran first. iOS devices are now correctly detected as `os: "ios"`.
- **Frozen macOS version number** — Apple froze the macOS version in Safari's UA string at `10_15_7`, so all macOS Safari users reported `osVersion: "10"`. The SDK now uses `navigator.userAgentData.platformVersion` for accurate versions on Chromium browsers and omits the misleading frozen version for Safari (reported as unknown).

## [0.2.1] - 2026-03-19

### Changed

- **Graceful field normalization** — `name`, `detail`, `step`, and `code` fields are now automatically normalized before buffering: lowercased, invalid characters replaced with underscores, leading/trailing underscores and dots trimmed, consecutive dots collapsed. Developers can now pass natural strings like `"Sign Up Button"` (becomes `"sign_up_button"`) or `"ERR_001"` (becomes `"err_001"`) instead of having them silently rejected.
- **PII stripping extended** — PII auto-stripping (emails, phone numbers, SSN patterns) now applies to `detail`, `step`, and `code` fields in addition to `name`.
- **Abuse detection extended** — anti-identifier patterns (UUID, long hex, long numeric, all-hex) now apply to `detail`, `step`, and `code` fields. Fields matching abuse patterns are omitted rather than rejecting the entire event.
- Empty `detail` or `code` values no longer cause the entire event to be dropped — the event is recorded without the optional field.

## [0.2.0] - 2026-03-19

### Added

- Static singleton API: `Trackless.configure(apiKey, endpoint)` with typed event methods
- Event types: `view(name, detail?)`, `feature(name, detail?)`, `funnel(name, stepIndex, stepName)`, `performance(name, duration, threshold?)`, `error(name, severity, code?)`
- Automatic session lifecycle management with duration and screen depth tracking
- Client-side event rollup — count-aggregatable events deduplicated and counted by key, performance durations collected into arrays
- Periodic flush every 60 seconds with auto-flush at 100 unique items
- Forced flush on page visibility change and `destroy()`
- Circuit breaker with exponential backoff (30s → 1m → 5m → 15m → 60m) on 5xx/network errors; 4xx errors discard the batch without backoff
- Coarse context detection: platform, OS major version, device class (phone/tablet/desktop via viewport + touch), region, app version, build number
- Browser detection for Chrome, Safari, Firefox, and Edge via `navigator.userAgentData`
- Optional automatic screen tracking from `history.pushState()`, `popstate`, and `hashchange` events with per-route deduplication (60s cooldown)
- PII guard strips emails, phone numbers, and SSN patterns from event names before buffering
- Identifier rejection for UUIDs, long hex sequences, numeric-only strings, and hex-dominant strings
- Event name validation: lowercase alphanumeric with `_`, `-`, `.` (1–100 chars)
- Environment field with explicit override (defaults to `production`)
- Zero dependencies
- Zero client-side persistence (no cookies, localStorage, sessionStorage, IndexedDB)
- Max buffer size of 1,000 unique items; max 100 events per HTTP request
