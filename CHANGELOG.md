# Changelog

All notable changes to the Trackless Telemetry Web SDK will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
