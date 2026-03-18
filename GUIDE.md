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

| Option               | Type                        | Default                                | Description                                   |
| -------------------- | --------------------------- | -------------------------------------- | --------------------------------------------- |
| `apiKey`             | `string`                    | **required**                           | API key with `tl_` prefix                     |
| `endpoint`           | `string`                    | `"https://api.tracklesstelemetry.com"` | Ingest endpoint URL                           |
| `environment`        | `"sandbox" \| "production"` | `"production"`                         | Set to `"sandbox"` for development/staging    |
| `enabled`            | `boolean`                   | `true`                                 | Set `false` to disable all recording          |
| `appVersion`         | `string`                    | `undefined`                            | Your app's version (e.g., `"2.1.0"`)          |
| `buildNumber`        | `string`                    | `undefined`                            | Your app's build number (e.g., `"142"`)       |
| `autoScreenTracking` | `boolean`                   | `false`                                | Auto-track SPA route changes as screen events |
| `onError`            | `(error: Error) => void`    | no-op                                  | Error callback for debugging                  |
| `flushIntervalMs`    | `number`                    | `60000`                                | Flush interval in milliseconds                |
| `debugLogging`       | `boolean`                   | `false`                                | Enable debug logging to console               |

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

### Screen Views

Record when a user views a screen or page. Use `autoScreenTracking: true` for SPA route changes, or call manually:

```typescript
Trackless.screen("home");
Trackless.screen("settings");
Trackless.screen("profile.edit");
```

**When to use:** Page/route loads, tab switches, modal views that represent distinct screens.

**With React Router:**

```tsx
import { useLocation } from "react-router-dom";
import { Trackless } from "@trackless-telemetry/sdk-web";
import { useEffect } from "react";

function useScreenTracking() {
  const location = useLocation();
  useEffect(() => {
    // Convert "/settings/profile" → "settings.profile"
    const name = location.pathname.slice(1).replace(/\//g, ".") || "home";
    Trackless.screen(name);
  }, [location.pathname]);
}
```

**With Vue Router:**

```typescript
import { Trackless } from "@trackless-telemetry/sdk-web";
router.afterEach((to) => {
  const name = ((to.name as string) ?? to.path.slice(1).replace(/\//g, ".")) || "home";
  Trackless.screen(name);
});
```

### Feature Usage

Record when a user interacts with a feature:

```typescript
Trackless.feature("export_clicked");
Trackless.feature("dark_mode_toggled");
Trackless.feature("photo-upload");
Trackless.feature("settings.notifications");
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

### Selections

Track choices from a set of options:

```typescript
Trackless.selection("theme", "dark");
Trackless.selection("theme", "light");
Trackless.selection("sort_order", "price_low_to_high");
Trackless.selection("plan", "pro_monthly");
Trackless.selection("language", "es");
```

**When to use:** Dropdown selections, radio button choices, toggle groups, filter options, plan selection — any place users pick from a defined set.

### Performance Metrics

Record timing measurements in seconds:

```typescript
// API response time
const start = performance.now();
const response = await fetch("/api/data");
Trackless.performance("api_fetch_data", (performance.now() - start) / 1000);

// Page load time
Trackless.performance("page_load", 1.23);

// Image processing time
Trackless.performance("image_resize", 0.45);
```

**When to use:** API latency, page load times, rendering durations, file processing times — any timing you want percentile distributions for (p50, p75, p90, p95, p99).

**Important:** Duration is in **seconds** (not milliseconds). Divide `performance.now()` results by 1000.

### Errors

Record application errors with severity and optional code:

```typescript
// Basic error
Trackless.error("payment_failed", "error");

// With error code
Trackless.error("api_timeout", "warning", "ETIMEDOUT");
Trackless.error("validation_failed", "info", "INVALID_EMAIL");

// In a catch block
try {
  await submitOrder();
} catch (e) {
  Trackless.error("order_submission", "error", e instanceof Error ? e.name : "unknown");
}
```

**Severity levels:** `"debug"` | `"info"` | `"warning"` | `"error"` | `"fatal"`

**When to use:** Caught exceptions, failed API calls, validation errors, any error condition you want to trend.

## 4. Event Naming Rules

All event names (screen, feature, funnel, selection, performance, error) follow the same rules:

| Rule               | Detail                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------- |
| **Auto-lowercase** | Names are automatically lowercased — `Export_Clicked` becomes `export_clicked`          |
| **Characters**     | Lowercase `a-z`, digits `0-9`, underscores `_`, hyphens `-`, dots `.`                   |
| **Length**         | 1–100 characters                                                                        |
| **Dots**           | Dots allowed for hierarchical grouping (e.g., `settings.theme`, `nav.settings.display`) |
| **No identifiers** | UUIDs, long hex strings, and numeric-only strings >12 chars are rejected                |

**Valid:** `checkout_started`, `settings.dark_mode`, `photo-upload`, `nav.settings.display`
**Also valid (auto-lowercased):** `Export_Clicked` → `export_clicked`, `Settings.Theme` → `settings.theme`
**Invalid:** `user 123` (space), `.leading-dot` (leading dot), `export!clicked` (special characters)

### Hierarchical Grouping with Dots

Use `.` delimiters to create hierarchical event names. The dashboard groups **feature** events by the first dot segment and shows donut charts with the distribution of values within each group.

```typescript
// These create a "theme" group in the dashboard with "dark" and "light" values
Trackless.feature("theme.dark");
Trackless.feature("theme.light");

// Deeper hierarchies work too — grouped by first segment ("settings")
Trackless.feature("settings.display.theme");
Trackless.feature("settings.display.layout");
Trackless.feature("settings.notifications");
```

**Which types support grouping?** Dots are allowed in names for all event types, but the dashboard's automatic group visualization (donut charts) currently applies to **`feature`** events only. For other use cases, consider the typed alternatives:

- Instead of `feature("theme.dark")` / `feature("theme.light")` → use `selection("theme", "dark")` for choice-from-a-set scenarios
- Use `feature` with dots when you want the dashboard group charts, or when the variants aren't mutually exclusive choices

## 5. Session Lifecycle

Sessions are managed automatically. No code needed.

- **Start:** A session begins when `Trackless.configure()` is called
- **End:** A session ends when the page is hidden (`visibilitychange`) or on `beforeunload`
- **Timeout:** If the page is hidden for 30+ minutes and becomes visible again, the previous session is ended and a new session starts
- **Depth:** Every non-session event increments the session's depth counter (used for session depth analytics)
- **Duration:** Measured from session start to session end (used for session duration analytics)

## 6. Flush Behavior

Events are buffered in memory and sent in batches:

- **Periodic flush:** Every 60 seconds (configurable) if the buffer is non-empty
- **Item threshold:** When the buffer reaches 100 unique items
- **Session end:** Flushed on page hide / beforeunload using `navigator.sendBeacon()`
- **Manual:** Call `Trackless.flush()` at any time
- **Client-side rollup:** Duplicate events are pre-aggregated in the buffer (e.g., 50 `feature("save")` calls become one event with `count: 50`), so 100 buffer items can represent thousands of raw calls

## 7. Cleanup

Call `destroy()` when your app unmounts (e.g., in a React `useEffect` cleanup or Vue `onUnmounted`):

```typescript
Trackless.destroy();
```

This flushes remaining events and removes all listeners. After `destroy()`, the instance is permanently disabled. Call `Trackless.configure()` again to re-initialize.

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
import { Trackless } from "@trackless-telemetry/sdk-web";

export function Checkout() {
  const handleAddToCart = () => {
    Trackless.feature("add_to_cart");
  };

  const handleSelectShipping = (method: string) => {
    Trackless.selection("shipping_method", method);
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
      Trackless.error("order_failed", "error", e instanceof Error ? e.name : "unknown");
    }
  };

  // ... render checkout UI
}
```

```tsx
// src/pages/Settings.tsx
import { Trackless } from "@trackless-telemetry/sdk-web";

export function Settings() {
  const handleThemeChange = (theme: string) => {
    Trackless.selection("theme", theme);
  };

  const handleExport = async () => {
    Trackless.feature("data_export");
    const start = performance.now();
    try {
      await exportData();
      Trackless.performance("data_export", (performance.now() - start) / 1000);
    } catch (e) {
      Trackless.error("export_failed", "error");
    }
  };

  // ... render settings UI
}
```

## 9. Privacy Guarantees

Trackless collects **no user identifiers** and stores **only aggregate counts**. Specifically:

- **No cookies, localStorage, sessionStorage, or IndexedDB** — zero browser persistence
- **No IDFA, fingerprinting, or device identifiers**
- **No IP address processing** — region comes from `navigator.language`, not IP geolocation
- **No cross-session linking** — all session state is in-memory only
- **No data sent to third parties** — events go only to your configured endpoint
- **PII auto-redaction** on custom event properties

The only context collected is: platform (`"web"`), OS version (major.minor from user agent), device class (phone/tablet/desktop from screen width heuristic), and locale (from `navigator.language`). All are coarse, non-identifying dimensions.

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
