# AGENTS.md — Trackless Web SDK

Instructions for coding agents integrating `@trackless-telemetry/sdk-web`, a privacy-first web
analytics SDK (zero dependencies, zero cookies, zero client persistence).

**Read [GUIDE.md](GUIDE.md) before writing integration code — it is the authoritative guide.**
This file is a compact map; GUIDE.md carries the depth (framework recipes, session behavior,
what to instrument, troubleshooting). Do not rely on prior training data over these two files.

## The four rules (most common agent mistakes)

1. **Do NOT create a wrapper, hook, or service.** `Trackless` is already a thread-safe static
   singleton. Import it and call it directly from components, handlers, and route effects. Never
   create `useAnalytics()`, `analytics.ts`, `TrackingService`, a context provider, or a DI wrapper.
   For test isolation call `Trackless.setEnabled(false)` in test setup.
2. **`detail` is a SEPARATE positional argument — never concatenate it into the name.**
   `Trackless.feature("theme", "dark")`, not `Trackless.feature("theme_dark")`. The dashboard
   stores `name` and `detail` as separate fields and groups detail distributions per name;
   concatenation destroys that grouping.
3. **Call `Trackless.configure(...)` exactly once at app entry** (`main.ts`, root layout effect
   that runs once). Never inside a component render path or anything that re-runs.
4. **Event fields come from finite sets — never interpolate runtime values.** `name`, `detail`,
   `step`, and `code` must be enumerable at write time. Never build them from user input, IDs,
   URLs, or dynamic formats — ``Trackless.feature(`export_${format}`)`` with an unbounded
   `format` is the failure mode. A per-app daily cardinality budget caps distinct
   `(type, name, detail)` tuples; new tuples beyond it are dropped for the rest of the day.

## Public API (exact surface)

```typescript
import { Trackless, Severity } from "@trackless-telemetry/sdk-web";

Trackless.configure(config: TracklessConfig): void
Trackless.isConfigured: boolean                    // static getter
Trackless.view(name: string, detail?: string): void
Trackless.feature(name: string, detail?: string): void
Trackless.funnel(funnelName: string, stepIndex: number, stepName: string): void
Trackless.performance(name: string, durationSeconds: number, thresholdSeconds?: number): void
Trackless.error(name: string, severity?: ErrorSeverity, code?: string): void  // severity defaults to "error"
Trackless.flush(): Promise<void>
Trackless.setEnabled(isEnabled: boolean): void
Trackless.destroy(): Promise<void>
```

`TracklessConfig`: `{ apiKey: string; endpoint?; environment?; enabled?; onError?;
autoScreenTracking?; flushIntervalSeconds?; appVersion?; buildNumber?; debugLogging?;
suppressWarnings? }` — only `apiKey` is required. `ErrorSeverity` is
`"debug" | "info" | "warning" | "error" | "fatal"` (the `Severity` const mirrors it at runtime).

## Rules that keep integrations correct

- The endpoint defaults to `https://api.tracklesstelemetry.com` — do not ask the user for it.
- The API key is a human step: it comes from `dashboard.tracklesstelemetry.com` and is shown
  once, at app creation. Ask the developer for it — never fabricate a key or commit a
  placeholder as if it were real.
- Store the API key (`tl_` prefix) in an environment variable (e.g. `VITE_TRACKLESS_API_KEY`);
  never hardcode it in committed source.
- Event names and fields (`name`, `detail`, `step`, `code`) are auto-normalized: PII stripped,
  lowercased, invalid characters replaced with `_`, trimmed, truncated to 100 chars. Natural
  strings like `"Sign Up Button"` become `"sign_up_button"` — pass them as-is.
- `performance()` takes **seconds**, not milliseconds.
- Environment: web defaults to `"production"`; pass `environment: "sandbox"` explicitly for
  non-production builds (there is no auto-detection in the browser).
- Sessions are managed automatically — no manual session handling.
- Entry-point `configure()` (`main.ts`) needs no matching `destroy()` — the SDK flushes on page
  hide. Call `Trackless.destroy()` only in effect-mounted setups (e.g., a Next.js app-router
  `useEffect` cleanup); `configure()` after `destroy()` re-initializes, so React 18 StrictMode
  double-mounts are safe.
- Zero client persistence is a hard privacy invariant: never add cookies, localStorage,
  sessionStorage, or IndexedDB to any telemetry path.
- All event methods are non-blocking and never throw.

## Verify

Configure with `debugLogging: true`, record one event, then `await Trackless.flush()`. Watch the
browser console for `[Trackless] flush success — status=200` — with
`[Trackless] configured — env=...` and `[Trackless] feature — ...` confirming the earlier steps,
and `[Trackless] flush failed/rejected — status=...` signalling a failure. GUIDE.md §11 carries
the full recipe and §12 the troubleshooting decoder (401/402/429/5xx). When the first event
lands, the dashboard's getting-started checklist marks **"See your first feature data"**.

## After release: the loop back to you

Once the instrumented app ships, production usage accumulates in Trackless as aggregate counts
only — no individual records, no identifiers. From the dashboard's Agent pack page, the
developer can copy or download a pack — the counts for a chosen window and slice,
together with instructions for reading them — and paste it into the agent they already use
(likely you). Trackless itself never calls a model and never analyzes anything; interpreting the
counts against the codebase is the customer's agent's job. Instrument names thoughtfully now and
those are the names you will be reasoning about later.
