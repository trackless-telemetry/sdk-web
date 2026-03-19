# Changelog

All notable changes to the Trackless Telemetry Web SDK will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
