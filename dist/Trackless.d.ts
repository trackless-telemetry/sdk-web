import type { TracklessConfig } from "./types.js";
import type { ErrorSeverity } from "./types.js";
export type { TracklessConfig } from "./types.js";
export type { EventPayload, EventContext, TracklessEvent, IngestResponse, Environment, ErrorSeverity, } from "./types.js";
/**
 * Trackless — privacy-first analytics SDK for the web.
 *
 * Static singleton API. Zero dependencies. Zero client persistence.
 *
 * Usage:
 * ```typescript
 * Trackless.configure({
 *   apiKey: 'tl_xxxxxxxxxxxxxxxx',
 * });
 *
 * Trackless.view('home');
 * Trackless.feature('export', 'csv');
 * Trackless.error('api_timeout', 'TIMEOUT_500');
 * Trackless.info('tier', 'paid');
 * ```
 */
/**
 * Severity constants for the deprecated `severity` parameter on
 * `Trackless.error()`.
 *
 * Kept exported so no published call breaks. New code needs neither: call
 * `error(name, code?)` for something that went wrong and `info(name, detail?)`
 * for something that did not.
 */
export declare const Severity: {
    /** @deprecated Nothing reads `debug` — it is sent as `info`. Call `Trackless.info(name, detail?)`. */
    readonly DEBUG: "debug";
    /** @deprecated Call `Trackless.info(name, detail?)` instead of passing this to `error()`. */
    readonly INFO: "info";
    /** @deprecated Nothing reads `warning` — it is sent as `error`. Call `Trackless.error(name, code?)`. */
    readonly WARNING: "warning";
    /** The level `error()` sends. Passing it explicitly is redundant. */
    readonly ERROR: "error";
    /** @deprecated Nothing reads `fatal` — it is sent as `error`. Call `Trackless.error(name, code?)`. */
    readonly FATAL: "fatal";
};
export declare class Trackless {
    private static apiKey;
    private static endpoint;
    private static environment;
    private static onError;
    private static flushIntervalSeconds;
    private static autoScreenTracking;
    private static debugLogging;
    private static suppressWarnings;
    /** Raw `appVersion` / `buildNumber` as configured, kept to compare repeat `configure()` calls. */
    private static appVersion;
    private static buildNumber;
    private static measureLaunch;
    private static launchThresholdSeconds;
    private static detectHangs;
    private static captureUncaught;
    private static enabled;
    private static destroyed;
    private static configured;
    /** One-shot flag: warn at most once per session when the buffer rejects an event. */
    private static bufferFullWarned;
    /** One-shot flag: warn at most once when events are recorded while unconfigured. */
    private static preConfigureWarned;
    private static buffer;
    private static circuitBreaker;
    private static context;
    private static session;
    /** Per-session first-use set backing feature-reach `firstUses` marking. Reset on session end. */
    private static featureReach;
    /** Per-session first-occurrence set backing error-reach `firstOccurrences` marking. Reset on session end. */
    private static errorReach;
    /**
     * Open timers. Not replaced on `configure()`, so a timer started before the
     * first configure survives it; a reconfigure discards them through
     * `endCurrentSession()`.
     */
    private static timers;
    /** The `measureLaunch` probe. Never replaced, so it measures once per page load. */
    private static launch;
    /** The `detectHangs` long-task observer, running only while the page is visible. */
    private static hangs;
    /** The `captureUncaught` window listeners, attached only while recording. */
    private static uncaught;
    /** One-shot flag: the reserved-prefix warning is logged once per page load. */
    private static reservedPrefixWarned;
    private static flushTimer;
    private static visibilityHandler;
    private static popstateHandler;
    private static hashchangeHandler;
    private static originalPushState;
    /** Per-route screen view deduplication: "name" or "name|detail" -> last recorded timestamp */
    private static screenViewCooldowns;
    /** Whether the SDK has been configured and is ready to record events. */
    static get isConfigured(): boolean;
    /**
     * Configure the SDK and start a new session.
     *
     * Safe to call again at runtime, for example to switch API key when the user
     * changes organization. A repeat call whose settings all match the running
     * configuration keeps the current session and buffer and only replaces
     * `onError`. A call that changes any setting ends the current session, sends
     * its buffered events under the previous key, endpoint and environment, and
     * then starts fresh exactly as a first call does.
     */
    static configure(config: TracklessConfig): void;
    /** Record a view event. */
    static view(name: string, detail?: string): void;
    /** Record a feature usage event. */
    static feature(name: string, detail?: string): void;
    /** Record a funnel step. Every call is counted, including a step index already sent this session. */
    static funnel(funnelName: string, stepIndex: number, stepName: string): void;
    /**
     * Record a performance measurement.
     *
     * Names starting with `trackless.` are reserved for the metrics the SDK
     * measures itself (`trackless.launch`, `trackless.hang`). Passing one logs a
     * warning once per page load; the measurement is still sent.
     */
    static performance(name: string, durationSeconds: number, thresholdSeconds?: number): void;
    /**
     * Start a timer for a performance measurement.
     *
     * The name is normalized here, exactly as `performance()` normalizes its
     * name, so `stopTimer("Checkout")` closes `startTimer("checkout")`. A name
     * normalization rejects is ignored with the usual warning. Starting a name
     * that is already open restarts it. At most 50 timers are open at once; a
     * start past that is ignored, with one warning per session.
     *
     * Open timers live in memory only. **Session end discards every open
     * timer** — the session ends when the page is hidden — as do
     * `setEnabled(false)`, a `configure()` with changed settings and
     * `destroy()`, so a timer never measures time the page spent hidden.
     * Elapsed time comes from `performance.now()`.
     */
    static startTimer(name: string): void;
    /**
     * Stop the timer `name` and send its elapsed time, in seconds, as
     * `performance(name, elapsed, thresholdSeconds)`.
     *
     * Does nothing when no timer of that name is open: never started, already
     * stopped or cancelled, or discarded when the session ended. An elapsed time
     * below zero or above a day is dropped.
     */
    static stopTimer(name: string, thresholdSeconds?: number): void;
    /**
     * Drop the timer `name` without sending anything — the operation was
     * abandoned, or failed in a way its duration should not describe.
     */
    static cancelTimer(name: string): void;
    /**
     * Time `fn` and send its duration as a performance measurement, returning
     * what `fn` returns.
     *
     * When `fn` returns a promise, the measurement covers the time until it
     * settles and `measure()` returns a promise of the same value. The
     * measurement is sent **only when `fn` returns, or its promise resolves**:
     * if `fn` throws or the promise rejects, nothing is sent and the error
     * reaches the caller unchanged. Nothing is sent when the session ended (the
     * page was hidden) before `fn` finished. `measure()` does not use the
     * open-timer map, so it never counts toward the 50-timer cap.
     *
     * ```typescript
     * const feed = await Trackless.measure("feed_load", () => api.fetchFeed(), 2.0);
     * ```
     */
    static measure<T>(name: string, fn: () => Promise<T>, thresholdSeconds?: number): Promise<T>;
    static measure<T>(name: string, fn: () => T, thresholdSeconds?: number): T;
    /**
     * Record an error event with an explicit severity.
     *
     * @deprecated The `severity` parameter is deprecated. Call
     * `error(name, code?)` for something that went wrong and
     * `info(name, detail?)` for something that did not. A severity of `info` or
     * `debug` is sent as `info`; every other value is sent as `error`.
     */
    static error(name: string, severity: ErrorSeverity, code?: string): void;
    /** Record an error event — something went wrong. */
    static error(name: string, code?: string): void;
    /**
     * Record an info event — something worth counting that the user did not do
     * and that did not go wrong.
     *
     * Counted separately from errors: an info event never contributes to errors
     * per session and never triggers an alert. Report configuration many sessions
     * share (a tier, a unit preference, a fallback path that fired), never
     * anything about the person. Do not share a name between `error()` and
     * `info()`.
     */
    static info(name: string, detail?: string): void;
    /**
     * Shared path behind `error()`, `info()` and `captureUncaught`: same
     * normalization, PII guard, session-reach marker and rollup key. `severity` is
     * already mapped to one of the two stored levels, so the buffer's rollup key
     * collapses one name reported at several legacy severities into a single
     * entry. A developer's call (`fromSdk` false) warns on a reserved name and
     * counts toward the session's depth; the SDK's own send does neither.
     */
    private static recordErrorEvent;
    private static isThenable;
    /** Send the measurement for one `measure()` call whose `fn` finished normally. */
    private static finishMeasure;
    /**
     * The send behind `stopTimer()` and `measure()`: `performance()` with an
     * elapsed time the SDK measured, under a name that is already normalized.
     */
    private static recordTimer;
    /**
     * Warn once per page load when a developer's normalized name has the
     * reserved prefix. `kind` names the call in the message.
     */
    private static warnIfReserved;
    /** A positive, finite threshold, or undefined. */
    private static validThreshold;
    /** Recording, without the pre-configure warning `canRecord()` logs. */
    private static isRecording;
    /**
     * Send the launch time the probe measured — only while recording with
     * `measureLaunch` on. A launch measured while recording is disabled, or
     * after a reconfigure turned the option off, is dropped.
     */
    private static deliverLaunch;
    /** Start the long-task observer when `detectHangs` is on and the page is visible. */
    private static startHangsIfVisible;
    /**
     * Attach the `captureUncaught` listeners when the option is on. Each
     * uncaught error or rejection is recorded as `error("trackless.uncaught",
     * <name>)`; a name normalization rejects is sent as `unknown`.
     */
    private static startUncaughtIfWanted;
    /**
     * Buffer one metric the SDK measured itself. Same bounds as a timer; no
     * reserved-name warning, and no session activity — it describes the page,
     * not anything the user did.
     */
    private static recordSdkMetric;
    /** Force flush pending events to the ingest endpoint. */
    static flush(): Promise<void>;
    /**
     * Toggle event recording. Disabling discards buffered data and drops the
     * session without sending its end; enabling again starts a new session.
     */
    static setEnabled(isEnabled: boolean): void;
    /** End the session, flush remaining events and clean up. Events are dropped until `configure()` is called again. */
    static destroy(): Promise<void>;
    /**
     * Whether `settings` match the running configuration. `enabled` is compared
     * with the live state, so a configure() after `setEnabled(false)` that asks
     * for recording is a change, not a no-op.
     */
    private static matchesRunningSettings;
    /**
     * Wind down the running configuration before a changed `configure()` applies.
     *
     * While recording is enabled, the current session's end goes into the
     * current buffer and that buffer is flushed under the current key, endpoint,
     * environment, context and circuit breaker. The flush is not awaited —
     * `configure()` stays synchronous — and it drains the buffer before its first
     * await, so nothing recorded under the new settings can join it. It runs
     * without `keepalive`: the page is still alive, and keepalive's 64 KB
     * in-flight quota is reserved for the page-hide flush. While recording is
     * disabled, nothing is sent: `setEnabled(false)` already discarded the
     * buffer and dropped the session.
     *
     * The flush timer, visibility listener and auto screen tracking are torn
     * down so the new configuration installs its own.
     */
    private static retireRunningConfiguration;
    /** The running configuration's buffer and send settings, captured now. */
    private static currentFlushTarget;
    private static canRecord;
    /**
     * Normalize an event field (name, detail, step, code) into a valid format.
     * Strips PII, lowercases, replaces invalid chars with underscores, and validates.
     * Returns null if the result is empty or matches an abuse pattern.
     *
     * The abuse patterns run on the whole value before the PII strip as well as on
     * the result: the phone pattern eats runs of digits inside a UUID or hex ID, and
     * truncating can cut one short, either of which leaves a part no rule matches.
     */
    private static normalizeField;
    /** Lowercases and reduces a value to the characters and shape a field allows. */
    private static sanitizeField;
    /** True when a sanitized field looks like an identifier and must not be sent. */
    private static isAbusePattern;
    /** The PII marker beside 8+ characters of hex-only tokens: what remains of an ID. */
    private static hasRedactedIdResidue;
    private static debug;
    private static warn;
    private static addEvent;
    /**
     * Strip PII patterns (emails, SSNs, phone numbers) from a string,
     * replacing matches with [REDACTED].
     *
     * Swift and Kotlin spell out what `\b` means in the SSN patterns, ASCII letters, digits and
     * `_`, because their regex engines do not agree with it. Those patterns stay without the `u`
     * flag, and nothing here uses lookbehind: it is a syntax error before Safari 16.4 and the SDK
     * would not load.
     */
    private static stripPII;
    /**
     * A UUID anywhere in the value, by its first four groups (8-4-4-4) so one with its
     * tail cut off is found too, with any run of hyphens, underscores or dots between them
     */
    private static readonly UUID_REGEX;
    /** 24 or more consecutive hex characters anywhere in the value */
    private static readonly LONG_HEX_REGEX;
    /** Numeric-only strings > 12 characters */
    private static readonly LONG_NUMERIC_REGEX;
    /** Entirely hex characters and longer than 16 characters */
    private static readonly ALL_HEX_REGEX;
    /** 6+ digit numeric ID in a URL path segment */
    private static readonly LONG_NUMERIC_RE;
    /** 12+ hex chars in a URL path segment (MongoDB ObjectIDs, short hashes) */
    private static readonly LONG_HEX_RE;
    /**
     * Lowercase words of 1-20 letters with up to 3 trailing digits, joined by one `-` or `_`.
     * A word after the first may instead be a number of up to 4 digits.
     */
    private static readonly ANCHOR_RE;
    private static readonly ANCHOR_MAX_LENGTH;
    private static normalizeName;
    private static startNewSession;
    private static endCurrentSession;
    private static checkFlushThreshold;
    /**
     * Drain `target`'s buffer and send it. `target` defaults to the running
     * configuration, captured when the flush starts; every payload of this flush
     * goes out under that capture even if `configure()` changes the key while
     * an earlier payload is in flight. `keepalive` is set only by the page-hide
     * flush, so the request can outlive the page.
     */
    private static performFlush;
    /**
     * Split a payload into payloads whose serialized size fits the ingest
     * request body limit. Oversized payloads have their events halved
     * recursively; a single-event payload that still exceeds the limit is
     * dropped with a warning. The wire format is unchanged — only the
     * batching boundaries move.
     */
    private static splitToBodyLimit;
    /** UTF-8 byte length of the serialized payload — matches the server-side Content-Length check. */
    private static payloadByteSize;
    private static startPeriodicFlush;
    private static stopPeriodicFlush;
    private static addVisibilityListener;
    private static removeVisibilityListener;
    private static setupAutoScreenTracking;
    private static teardownAutoScreenTracking;
    private static recordScreenView;
    /**
     * Whether a URL hash reads as a section anchor. Browsers never send a hash to a
     * server, so it is where sign-in tokens, share keys and recovery links go, and the
     * SDK must not be what sends one. The shape is an allowlist because a left-out hash
     * costs little: the view still counts on its bare name, under that name's cooldown.
     */
    private static isPlainAnchor;
    /**
     * Replace dynamic URL segments with `-id-`: anything the abuse patterns would
     * reject, so `/users/user-<uuid>/profile` is still counted as a view, plus the
     * shorter numeric and hex IDs below.
     */
    private static stripDynamicSegments;
    /** Convert a URL path to a screen name */
    private static pathToScreenName;
}
