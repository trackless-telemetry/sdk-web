import type { EventPayload, EventContext, TracklessEvent, IngestResponse, Environment, ErrorSeverity } from "./wire.js";
/** SDK configuration options */
export interface TracklessConfig {
    /** API key in tl_* format (required) */
    apiKey: string;
    /** Ingest endpoint URL (default: https://api.tracklesstelemetry.com) */
    endpoint?: string;
    /**
     * Environment tag: 'sandbox' or 'production'. When omitted: 'sandbox' on a
     * localhost / loopback page (localhost, *.localhost, 127.x.x.x, [::1],
     * 0.0.0.0), 'production' everywhere else. Set it explicitly for LAN IPs,
     * .local/.test hosts, staging, preview deploys and Electron / file: pages.
     */
    environment?: Environment;
    /** Enable/disable event recording (default: true) */
    enabled?: boolean;
    /** Optional error callback for debugging */
    onError?: (error: Error) => void;
    /** Auto-track screen views via pushState/popstate (default: false) */
    autoScreenTracking?: boolean;
    /** Flush interval in seconds (default: 60) */
    flushIntervalSeconds?: number;
    /** App version string for context (optional) */
    appVersion?: string;
    /** Build number string for context (optional) */
    buildNumber?: string;
    /** Enable debug logging to console for happy-path events (default: false) */
    debugLogging?: boolean;
    /** Suppress warning and error logging to console (default: false) */
    suppressWarnings?: boolean;
    /**
     * Send the page's load time once per page load, as the performance metric
     * `trackless.launch`: seconds from navigation start to the `load` event,
     * from the page's `PerformanceNavigationTiming` entry (read at once when
     * `load` has already fired). Soft navigations are not launches. A page
     * that did not load in front of the user sends nothing: a prerendered page,
     * a page hidden at any time before `load` (in browsers without
     * `visibility-state` performance entries, only a hidden period from
     * `configure()` on can be seen), and a launch longer than 60 seconds, which
     * is dropped, not clipped. Off by default (default: false).
     */
    measureLaunch?: boolean;
    /**
     * Optional threshold for `trackless.launch`, in seconds, so the breach count
     * and performance alerts work on it. A value that is not a positive number
     * is ignored, with a warning.
     */
    launchThresholdSeconds?: number;
    /**
     * Send each main-thread long task of 250 ms or more as one `trackless.hang`
     * sample, in seconds, from a `PerformanceObserver` on `longtask` entries,
     * only while the page is visible. Chromium-only: Safari and Firefox send no
     * hang data. Off by default (default: false).
     */
    detectHangs?: boolean;
    /**
     * Count errors no code caught, as the error `trackless.uncaught` with the
     * error's `name` as its code (`typeerror`), from window `error` and
     * `unhandledrejection` listeners; a rejection with a value that is not an
     * `Error` is sent as `non_error`. Opaque cross-origin "Script error." events
     * and errors from browser-extension scripts are skipped. No message, stack,
     * file name or line is read into an event, and the browser still logs every
     * error. Off by default (default: false).
     */
    captureUncaught?: boolean;
}
/** Result from the HTTP send */
export interface SendResult {
    status: number;
    body?: IngestResponse;
}
export type { EventPayload, EventContext, TracklessEvent, IngestResponse, Environment, ErrorSeverity, };
