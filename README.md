# Trackless Telemetry Web SDK

Privacy-first analytics for web apps. Record what features your users use — without tracking who they are.

Trackless collects **aggregate usage counts** with coarse device context. No user identifiers. No fingerprinting. No cookies. No client-side persistence of any kind. Fully compliant with GDPR, CCPA, PECR, and ePrivacy — with nothing to consent to.

## Requirements

- Any modern browser supporting ES2020+ (Chrome 80+, Firefox 80+, Safari 14+, Edge 80+)
- Works with any framework (React, Vue, Svelte, Angular, Next.js) or vanilla JavaScript/TypeScript

## Installation

### npm

```bash
npm install @trackless-telemetry/sdk-web
```

### Script Tag (UMD)

The package includes a UMD build at `dist/trackless.umd.cjs` for use via `<script>` tag or CDN:

```html
<script src="https://unpkg.com/@trackless-telemetry/sdk-web"></script>
<script>
  TracklessTelemetry.Trackless.configure({
    apiKey: "tl_your_api_key_here",
  });
</script>
```

## Quick Start

```typescript
import { Trackless, Severity } from "@trackless-telemetry/sdk-web";

// Initialize once at app startup
Trackless.configure({
  apiKey: "tl_your_api_key_here",
});

// Record events anywhere in your app
Trackless.view("home");
Trackless.view("settings", "profile");
Trackless.feature("export_clicked");
Trackless.feature("export_clicked", "csv");
Trackless.funnel("checkout", 0, "view_cart");
Trackless.performance("api_fetch", 0.342);
Trackless.error("payment_failed", Severity.ERROR, "DECLINED");
```

## API Reference

### Configuration

```typescript
// Simple — just an API key with default settings
Trackless.configure({
  apiKey: "tl_your_api_key_here",
});

// All options
Trackless.configure({
  apiKey: "tl_your_api_key_here",
  endpoint: "https://custom.api.com", // Optional — defaults to https://api.tracklesstelemetry.com
  environment: "sandbox", // Optional — defaults to "production"
  enabled: true, // Optional — disable to suppress all recording
  appVersion: "2.1.0", // Optional — your app's version string
  buildNumber: "142", // Optional — your app's build number
  autoScreenTracking: false, // Optional — auto-track SPA route changes
  onError: (error) => console.error(error), // Optional — callback for debugging
  flushIntervalSeconds: 60, // Optional — how often buffered events are sent
  debugLogging: false, // Optional — enable debug logging for happy-path events
  suppressWarnings: false, // Optional — suppress warning and error logging
});
```

**Environment:** Defaults to `"production"`. Set to `"sandbox"` for development and staging environments.

**Auto screen tracking:** When enabled, the SDK automatically records view events from `history.pushState()`, `popstate`, and `hashchange` events with per-route deduplication (60-second cooldown). Hash fragments are captured as the detail parameter.

### Event Methods

All methods are static, non-blocking, non-throwing, and safe to call from any context.

| Method                                                                                    | Description                           |
| ----------------------------------------------------------------------------------------- | ------------------------------------- |
| `Trackless.view(name: string, detail?: string)`                                           | View event (optional detail)          |
| `Trackless.feature(name: string, detail?: string)`                                        | Feature interaction (optional detail) |
| `Trackless.funnel(funnelName: string, stepIndex: number, stepName: string)`               | Funnel step progression               |
| `Trackless.performance(name: string, durationSeconds: number, thresholdSeconds?: number)` | Timing measurement (seconds)          |
| `Trackless.error(name: string, severity: ErrorSeverity, code?: string)`                   | Application error                     |

### Control Methods

```typescript
Trackless.isConfigured; // Check if SDK is ready (boolean property)

Trackless.setEnabled(false); // Stop recording, discard buffer
Trackless.setEnabled(true); // Resume recording

await Trackless.flush(); // Force-send buffered events
await Trackless.destroy(); // Flush and permanently disable
```

## Event Naming Rules

All event fields (`name`, `detail`, `step`, `code`) are automatically normalized:

- **Auto-normalize:** spaces and invalid characters are replaced with `_` (`Sign Up Button` -> `sign_up_button`)
- **Auto-lowercase:** fields are lowercased (`Export_Clicked` -> `export_clicked`)
- **Trim/collapse:** leading/trailing `_`/`.` trimmed, consecutive dots collapsed
- **Truncate:** fields are truncated to 100 characters
- **Dots:** dots allowed for hierarchical grouping (e.g., `settings.theme`, `nav.settings.display`)
- **No identifiers:** UUIDs, long hex strings, and long numeric strings are rejected
- **PII stripping:** emails, phone numbers, and SSN patterns are stripped from all fields

## How It Works

1. **Buffering** -- Events are aggregated in memory. Duplicate events increment a counter rather than creating separate entries.
2. **Periodic flush** -- Every 60 seconds (configurable), the buffer is sent to the ingest endpoint as a batch.
3. **Page lifecycle flush** -- The SDK flushes when the page is hidden (`visibilitychange`) using `fetch()` with `keepalive: true`.
4. **Session management** -- Sessions start on configure and on each `visibilitychange` to "visible", end on `visibilitychange` to "hidden" with immediate flush.
5. **Circuit breaker** -- Server errors trigger exponential backoff (30s -> 60s -> 5m -> 15m -> 60m).
6. **Bounded memory** -- Buffer holds up to 1,000 unique entries. Beyond that, new entries are silently dropped.

## Context Collected

The SDK captures a small set of **coarse, non-identifying** dimensions:

| Dimension             | Example             | Source                                                    |
| --------------------- | ------------------- | --------------------------------------------------------- |
| `platform`            | `"web"`             | Compile-time constant                                     |
| `osVersion`           | `"14"`              | `userAgentData.platformVersion` or UA string (major only) |
| `os`                  | `"macos"`           | `userAgentData.platform` or UA string                     |
| `deviceClass`         | `"desktop"`         | Viewport width + touch capability heuristic               |
| `browser`             | `"chrome"`          | `userAgentData.brands` or vendor string                   |
| `region`              | `"US"`              | `navigator.language` (country code)                       |
| `language`            | `"en"`              | `navigator.language` (ISO 639-1 code)                     |
| `appVersion`          | `"2.1.0"`           | Developer-provided via config                             |
| `buildNumber`         | `"142"`             | Developer-provided via config                             |
| `sdkVersion`          | `"web/0.2.5"`       | SDK platform and version identifier                       |
| `distributionChannel` | `"www.example.com"` | `window.location.hostname`                                |

## What Trackless Does NOT Collect

- No cookies, localStorage, sessionStorage, or IndexedDB -- zero browser persistence
- No IDFA, fingerprinting, or device identifiers
- No IP address processing by application code -- region comes from `navigator.language`, not IP geolocation
- No cross-session linking -- all session state is in-memory only
- No data sent to third parties -- events go only to your configured endpoint
- No full user agent strings, exact screen dimensions, or hardware identifiers
- No stack traces, crash logs, or error messages -- error tracking uses only developer-defined names, severity levels, and codes
- No individual performance measurements stored -- durations are aggregated server-side into statistical digests
- PII auto-stripping of email addresses, phone numbers, and SSN patterns from all event fields

## Zero Client Persistence

The Trackless Web SDK uses **no client-side storage whatsoever**:

- No cookies
- No localStorage
- No sessionStorage
- No IndexedDB

All event data is buffered in memory only. When the page is closed or hidden, buffered events are flushed to the server and the buffer is discarded. There is nothing to persist, nothing to consent to, and nothing for privacy auditors to flag.

## License

MIT License. See [LICENSE](LICENSE) for details.
