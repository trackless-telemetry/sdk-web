# Trackless Web SDK — Implementation Guide

> This guide is designed for AI coding assistants. Follow the steps exactly to add privacy-first analytics to any web application.

## 1. Install

```bash
npm install @trackless-telemetry/sdk-web
```

No other dependencies are needed. The SDK is zero-dependency, zero-persistence (no cookies, localStorage, sessionStorage, or IndexedDB).

## 2. Configure

Call `Trackless.configure()` once at app startup — before any events are recorded.

```typescript
import { Trackless } from "@trackless-telemetry/sdk-web";

Trackless.configure({
  apiKey: "tl_your_api_key_here",
});
```

### Configuration Options

| Option                 | Type                        | Default                                | Description                                                     |
| ---------------------- | --------------------------- | -------------------------------------- | --------------------------------------------------------------- |
| `apiKey`               | `string`                    | **required**                           | API key with `tl_` prefix                                       |
| `endpoint`             | `string`                    | `"https://api.tracklesstelemetry.com"` | Ingest endpoint URL                                             |
| `environment`          | `"sandbox" \| "production"` | `"production"`                         | Set to `"sandbox"` for development/staging                      |
| `enabled`              | `boolean`                   | `true`                                 | Set `false` to disable all recording                            |
| `appVersion`           | `string`                    | `undefined`                            | Your app's version (e.g., `"2.1.0"`)                            |
| `buildNumber`          | `string`                    | `undefined`                            | Your app's build number (e.g., `"142"`)                         |
| `autoScreenTracking`   | `boolean`                   | `false`                                | Auto-track SPA route changes and hash navigation as view events |
| `onError`              | `(error: Error) => void`    | no-op                                  | Error callback for debugging                                    |
| `flushIntervalSeconds` | `number`                    | `60`                                   | Flush interval in seconds                                       |
| `debugLogging`         | `boolean`                   | `false`                                | Enable debug logging for happy-path events                      |
| `suppressWarnings`     | `boolean`                   | `false`                                | Suppress warning and error logging to console                   |

### Where to Put It

| Framework            | Location                                                                     |
| -------------------- | ---------------------------------------------------------------------------- |
| **React**            | `src/main.tsx` or `src/index.tsx`, before `ReactDOM.createRoot()`            |
| **Vue**              | `src/main.ts`, before `createApp()`                                          |
| **Next.js**          | `app/layout.tsx` in a client component, or a `useEffect` in your root layout |
| **Svelte/SvelteKit** | `src/routes/+layout.svelte` in an `onMount`                                  |
| **Angular**          | `src/main.ts`, before `bootstrapApplication()`                               |
| **Vanilla JS**       | `<script>` tag at the top of your entry point                                |

### React Example

```tsx
// src/main.tsx
import { Trackless } from "@trackless-telemetry/sdk-web";
import { createRoot } from "react-dom/client";
import App from "./App";

Trackless.configure({
  apiKey: import.meta.env.VITE_TRACKLESS_API_KEY,
  environment: import.meta.env.DEV ? "sandbox" : "production",
  appVersion: "1.2.0",
  autoScreenTracking: true,
});

createRoot(document.getElementById("root")!).render(<App />);
```

### Vue Example

```typescript
// src/main.ts
import { Trackless } from "@trackless-telemetry/sdk-web";
import { createApp } from "vue";
import App from "./App.vue";

Trackless.configure({
  apiKey: import.meta.env.VITE_TRACKLESS_API_KEY,
  environment: import.meta.env.DEV ? "sandbox" : "production",
  appVersion: "1.2.0",
  autoScreenTracking: true,
});

createApp(App).mount("#app");
```

### Next.js Example

```tsx
// src/components/Analytics.tsx
"use client";
import { Trackless } from "@trackless-telemetry/sdk-web";
import { useEffect } from "react";

export function Analytics() {
  useEffect(() => {
    Trackless.configure({
      apiKey: process.env.NEXT_PUBLIC_TRACKLESS_API_KEY!,
      environment: process.env.NODE_ENV === "development" ? "sandbox" : "production",
      appVersion: "1.2.0",
      autoScreenTracking: true,
    });
    return () => {
      Trackless.destroy();
    };
  }, []);
  return null;
}

// app/layout.tsx
import { Analytics } from "@/components/Analytics";
export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
```

## 3. Track Events

All methods are static. Call them anywhere after `configure()`.

### Views

Record when a user views a screen or page. Use `autoScreenTracking: true` for SPA route changes, or call manually:

```typescript
Trackless.view("home");
Trackless.view("settings");
Trackless.view("profile.edit");
```

**When to use:** Page/route loads, tab switches, modal views that represent distinct screens.

#### The `detail` Parameter

Use the optional `detail` parameter to distinguish sub-views or sections within a page:

```typescript
// Landing page sections (anchor navigation)
Trackless.view("home", "features");
Trackless.view("home", "pricing");

// Tab views within a page
Trackless.view("settings", "general");
Trackless.view("settings", "notifications");

// Modal or overlay views
Trackless.view("dashboard", "filter-panel");
```

Each `name + detail` combination is aggregated separately, so you can see which sections get the most attention. When `autoScreenTracking` is enabled, hash fragments are automatically captured as the detail — navigating to `yoursite.com/#pricing` records `view("home", "pricing")`.

**With React Router:**

```tsx
import { useLocation } from "react-router-dom";
import { Trackless } from "@trackless-telemetry/sdk-web";
import { useEffect } from "react";

function useViewTracking() {
  const location = useLocation();
  useEffect(() => {
    // Convert "/settings/profile" → "settings.profile"
    const name = location.pathname.slice(1).replace(/\//g, ".") || "home";
    Trackless.view(name);
  }, [location.pathname]);
}
```

**With Vue Router:**

```typescript
import { Trackless } from "@trackless-telemetry/sdk-web";
router.afterEach((to) => {
  const name = ((to.name as string) ?? to.path.slice(1).replace(/\//g, ".")) || "home";
  Trackless.view(name);
});
```

### Feature Usage

Record when a user interacts with a feature. Use the optional `detail` parameter to distinguish variants:

```typescript
Trackless.feature("export_clicked");
Trackless.feature("dark_mode_toggled");
Trackless.feature("photo-upload");
Trackless.feature("settings", "notifications");

// With detail to compare variants
Trackless.feature("share", "twitter");
Trackless.feature("share", "email");
Trackless.feature("sort", "price_low_to_high");
```

**When to use:** Button clicks, toggles, actions — any user-initiated feature interaction.

### Funnel Steps

Track progression through multi-step flows. Each step has a developer-defined index (0-based) that determines its position in the funnel:

```typescript
// Checkout funnel
Trackless.funnel("checkout", 0, "view_cart");
Trackless.funnel("checkout", 1, "enter_shipping");
Trackless.funnel("checkout", 2, "enter_payment");
Trackless.funnel("checkout", 3, "confirm_order");
Trackless.funnel("checkout", 4, "order_complete");

// Onboarding funnel
Trackless.funnel("onboarding", 0, "welcome");
Trackless.funnel("onboarding", 1, "create_account");
Trackless.funnel("onboarding", 2, "verify_email");
Trackless.funnel("onboarding", 3, "setup_profile");
```

**When to use:** Checkout flows, onboarding wizards, sign-up sequences, any multi-step process where you want to measure drop-off between steps.

**Rules:**

- Step index is developer-defined (0-based) and determines the order of steps in funnel charts
- Steps are deduplicated per session — calling the same step index twice is a no-op
- Funnel state resets on session end

### Performance Metrics

Record timing measurements in **seconds**, with an optional **threshold** for breach tracking:

```typescript
// API response time
const start = performance.now();
const response = await fetch("/api/data");
Trackless.performance("api_fetch_data", (performance.now() - start) / 1000);

// Page load time
Trackless.performance("page_load", 1.23);

// Image processing time
Trackless.performance("image_resize", 0.45);

// With threshold — track how many measurements exceed 2 seconds
Trackless.performance("api_fetch_data", (performance.now() - start) / 1000, 2.0);

// Named parameters for clarity
Trackless.performance("api_fetch_data", durationSeconds, thresholdSeconds);
```

**When to use:** API latency, page load times, rendering durations, file processing times — any timing you want percentile distributions for (p50, p90, p99).

**Threshold:** The optional third parameter defines a performance threshold in seconds. Each name/threshold combination is tracked separately, with breach counts (measurements exceeding the threshold) shown in the dashboard.

**Important:** Duration is in **seconds** (not milliseconds). Divide `performance.now()` results by 1000. Typical values: 0.05–5.0 for API calls, 0.5–10.0 for page loads. Values &le; 0 are dropped. Threshold must be > 0.

### Errors

Record application errors with severity and optional code. Use the exported `Severity` constants for type-safe severity values:

```typescript
import { Trackless, Severity } from "@trackless-telemetry/sdk-web";

// Basic error
Trackless.error("payment_failed", Severity.ERROR);

// With error code
Trackless.error("api_timeout", Severity.WARNING, "ETIMEDOUT");
Trackless.error("validation_failed", Severity.INFO, "INVALID_EMAIL");

// In a catch block
try {
  await submitOrder();
} catch (e) {
  Trackless.error("order_submission", Severity.ERROR, e instanceof Error ? e.name : "unknown");
}
```

**Severity levels:** `Severity.DEBUG`, `Severity.INFO`, `Severity.WARNING`, `Severity.ERROR`, `Severity.FATAL` (or string literals `"debug"` | `"info"` | `"warning"` | `"error"` | `"fatal"`)

**When to use:** Caught exceptions, failed API calls, validation errors, any error condition you want to trend.

## 4. Event Naming Rules

All event fields (`name`, `detail`, `step`, `code`) are automatically normalized before buffering:

| Rule               | Detail                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| **Auto-lowercase** | Fields are lowercased — `Export_Clicked` becomes `export_clicked`                               |
| **Auto-normalize** | Spaces and invalid characters are replaced with `_` — `Sign Up Button` becomes `sign_up_button` |
| **Trim**           | Leading/trailing underscores and dots are removed — `...foo...` becomes `foo`                   |
| **Collapse dots**  | Consecutive dots are collapsed — `foo..bar` becomes `foo.bar`                                   |
| **Truncate**       | Truncated to 100 characters                                                                     |
| **No identifiers** | UUIDs, long hex strings, and numeric-only strings >12 chars are rejected                        |
| **PII stripping**  | Emails, phone numbers, and SSN patterns are stripped from all fields                            |

**Valid characters after normalization:** Lowercase `a-z`, digits `0-9`, underscores `_`, hyphens `-`, dots `.`

**Examples:** `"Sign Up Button"` → `"sign_up_button"`, `"ERR_001"` → `"err_001"`, `"Export!Clicked"` → `"export_clicked"`, `"Settings.Theme"` → `"settings.theme"`

### Feature Grouping with Detail

Use the optional `detail` parameter to distinguish variants within a feature. The dashboard groups features that have detail values and shows donut charts with the distribution.

```typescript
// These create a "theme" group in the dashboard with "dark" and "light" values
Trackless.feature("theme", "dark");
Trackless.feature("theme", "light");

// Use detail for any choice-from-a-set scenario
Trackless.feature("distance_preset", "1_mile");
Trackless.feature("distance_preset", "2_miles");
Trackless.feature("settings", "notifications");
```

**Which types support grouping?** The `detail` parameter is supported on `feature` and `view` events. The dashboard's automatic group visualization (donut charts) applies to both.

## 5. Session Lifecycle

Sessions are managed automatically. No code needed.

- **Start:** A session begins when `Trackless.configure()` is called, and a new session starts each time the page becomes visible again
- **End:** A session ends when the page is hidden (`visibilitychange`) — the session-end event (with duration and depth) is flushed immediately
- **Depth:** Every non-session event increments the session's depth counter (used for session depth analytics)
- **Duration:** Measured from session start to session end (used for session duration analytics)

## 6. Flush Behavior

Events are buffered in memory and sent in batches:

- **Periodic flush:** Every 60 seconds (configurable) if the buffer is non-empty
- **Item threshold:** When the buffer reaches 100 unique items
- **Session end:** Flushed on page hide / beforeunload using `fetch()` with `keepalive: true`
- **Manual:** Call `Trackless.flush()` at any time
- **Client-side rollup:** Duplicate events are pre-aggregated in the buffer (e.g., 50 `feature("save")` calls become one event with `count: 50`), so 100 buffer items can represent thousands of raw calls

## 7. State & Cleanup

Check whether the SDK is configured before recording in shared code:

```typescript
if (Trackless.isConfigured) {
  Trackless.feature("shared_action");
}
```

Call `destroy()` when your app unmounts (e.g., in a React `useEffect` cleanup or Vue `onUnmounted`):

```typescript
Trackless.destroy();
```

This flushes remaining events and removes all listeners. After `destroy()`, the instance is permanently disabled (`isConfigured` returns `false`). Call `Trackless.configure()` again to re-initialize.

## 8. Complete Integration Example

### React App with All Event Types

```tsx
// src/analytics.ts — configure once
import { Trackless } from "@trackless-telemetry/sdk-web";

export function initAnalytics() {
  Trackless.configure({
    apiKey: import.meta.env.VITE_TRACKLESS_API_KEY,
    environment: import.meta.env.DEV ? "sandbox" : "production",
    appVersion: "2.1.0",
    buildNumber: "142",
    autoScreenTracking: true,
  });
}
```

```tsx
// src/main.tsx
import { initAnalytics } from "./analytics";
initAnalytics();
// ... render app
```

```tsx
// src/pages/Checkout.tsx
import { Trackless, Severity } from "@trackless-telemetry/sdk-web";

export function Checkout() {
  const handleAddToCart = () => {
    Trackless.feature("add_to_cart");
  };

  const handleSelectShipping = (method: string) => {
    Trackless.feature("shipping_method", method);
    Trackless.funnel("checkout", 1, "select_shipping");
  };

  const handleSubmitOrder = async () => {
    Trackless.funnel("checkout", 2, "submit_order");
    const start = performance.now();
    try {
      await placeOrder();
      Trackless.performance("order_submission", (performance.now() - start) / 1000);
      Trackless.funnel("checkout", 3, "order_complete");
    } catch (e) {
      Trackless.error("order_failed", Severity.ERROR, e instanceof Error ? e.name : "unknown");
    }
  };

  // ... render checkout UI
}
```

```tsx
// src/pages/Settings.tsx
import { Trackless, Severity } from "@trackless-telemetry/sdk-web";

export function Settings() {
  const handleThemeChange = (theme: string) => {
    Trackless.feature("theme", theme);
  };

  const handleExport = async () => {
    Trackless.feature("data_export");
    const start = performance.now();
    try {
      await exportData();
      Trackless.performance("data_export", (performance.now() - start) / 1000);
    } catch (e) {
      Trackless.error("export_failed", Severity.ERROR);
    }
  };

  // ... render settings UI
}
```

## 9. Privacy Guarantees

Trackless collects **no user identifiers** and stores **only aggregate counts**. Specifically:

- **No cookies, localStorage, sessionStorage, or IndexedDB** — zero browser persistence
- **No IDFA, fingerprinting, or device identifiers**
- **No IP address processing by application code** — IP addresses are never read, parsed, stored, or used by the SDK or the Trackless backend. Region comes from `navigator.language`, not IP geolocation. (AWS infrastructure receives IP addresses for network routing and DDoS protection as part of standard cloud operations, but they are not used for analytics.)
- **No cross-session linking** — all session state is in-memory only
- **No data sent to third parties** — events go only to your configured endpoint
- **No stack traces, crash logs, or error messages** — error tracking uses only developer-defined names, severity levels, and codes
- **No individual performance measurements stored** — durations are aggregated server-side into statistical digests (t-digest)
- **PII auto-stripping** — email addresses, phone numbers, and SSN patterns are automatically stripped from all event fields before buffering

The only context collected is: platform (`"web"`), OS version (major.minor from user agent), device class (phone/tablet/desktop from screen width heuristic), locale (from `navigator.language`), language (ISO 639-1 code from `navigator.language`, e.g., `"en"`), `sdkVersion` (e.g., `web/0.2.5`), and distribution channel (the page hostname, e.g., `"www.example.com"`). All are coarse, non-identifying dimensions.

## 10. Environment Variables

For framework-specific env var configuration:

| Framework               | Env Var Prefix   | Example                         |
| ----------------------- | ---------------- | ------------------------------- |
| Vite (React/Vue/Svelte) | `VITE_`          | `VITE_TRACKLESS_API_KEY`        |
| Next.js                 | `NEXT_PUBLIC_`   | `NEXT_PUBLIC_TRACKLESS_API_KEY` |
| Create React App        | `REACT_APP_`     | `REACT_APP_TRACKLESS_API_KEY`   |
| Angular                 | `environment.ts` | `environment.tracklessApiKey`   |

```env
# .env
VITE_TRACKLESS_API_KEY=tl_your_api_key_here
```

**Never commit API keys to source control.** Add `.env` to `.gitignore`.
