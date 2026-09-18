# Changelog

All notable changes to the Trackless Telemetry Web SDK will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
