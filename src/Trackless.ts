import type { TracklessConfig, EventContext, EventPayload } from "./types.js";
import type { TracklessEvent, Environment, ErrorSeverity } from "./types.js";
import { EventBuffer } from "./eventBuffer.js";
import { CircuitBreaker } from "./circuitBreaker.js";
import { defaultEnvironment, detectContext } from "./context.js";
import { SessionManager } from "./session.js";
import { FunnelTracker } from "./funnel.js";
import { FeatureReachTracker } from "./featureReach.js";
import { ErrorReachTracker } from "./errorReach.js";
import { OpenTimers, MAX_OPEN_TIMERS, MAX_TIMER_ELAPSED_SECONDS } from "./timers.js";
import type { TimerStart } from "./timers.js";
import { LaunchProbe } from "./launch.js";
import { HangObserver } from "./hangs.js";
import { UncaughtListener } from "./uncaught.js";
import { sendPayload } from "./http.js";

export type { TracklessConfig } from "./types.js";
export type {
  EventPayload,
  EventContext,
  TracklessEvent,
  IngestResponse,
  Environment,
  ErrorSeverity,
} from "./types.js";

/**
 * Event name validation regex.
 * Lowercase alphanumeric, dots, underscores, hyphens. 1-100 characters.
 * No leading/trailing/consecutive dots.
 */
const EVENT_NAME_REGEX = /^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/;
const EVENT_NAME_MAX_LENGTH = 100;

/**
 * Reason text for a name that fails normalization.
 *
 * The raw name is deliberately omitted. Normalization only fails *after* PII
 * stripping has run, so no PII-stripped form of the name survives to report.
 * The inputs that actually reach this branch are the ones the PII guard does
 * *not* recognize — anything it does recognize is replaced with the literal
 * "[REDACTED]", which normalizes to a non-empty "redacted" and is accepted.
 * What is left is chiefly non-Latin-script text, which includes personal
 * names. Emitting it would put that value in the browser console and — via
 * `onError` — into whatever crash reporter the host app forwards errors to.
 */
const INVALID_EVENT_NAME_REASON =
  "it normalized to an empty or disallowed value (raw name omitted: it may contain PII)";

/** Default flush interval: 60 seconds */
const DEFAULT_FLUSH_INTERVAL_SECONDS = 60;

/** Default flush timeout: 10 seconds */
const FLUSH_TIMEOUT_MS = 10_000;

/** Screen view deduplication cooldown: 60 seconds */
const SCREEN_VIEW_COOLDOWN_MS = 60_000;

/** Flush when buffer reaches this many unique items */
const BUFFER_FLUSH_THRESHOLD = 100;

/** Default production ingest endpoint */
const DEFAULT_ENDPOINT = "https://api.tracklesstelemetry.com";

/**
 * Names starting with this are reserved for what the SDK sends itself.
 * `performance()`, `startTimer()`, `measure()`, `error()` and `info()` warn
 * once per page load when given one, and send it anyway.
 */
const RESERVED_NAME_PREFIX = "trackless.";

/** The metric `measureLaunch` sends. */
const LAUNCH_METRIC = "trackless.launch";

/** The metric `detectHangs` sends. */
const HANG_METRIC = "trackless.hang";

/** The error `captureUncaught` sends. */
const UNCAUGHT_ERROR = "trackless.uncaught";

/** The code sent when an error's name does not survive normalization. */
const UNCAUGHT_UNKNOWN_CODE = "unknown";

// Every non-ASCII character but the Unicode spaces the phone pattern lists can be part of an address.
const EMAIL_NON_ASCII = String.raw`\u00A1-\u167F\u1681-\u1FFF\u200B-\u2027\u202A-\u202E\u2030-\u205E\u2060-\u2FFF\u3001-\uFEFE\uFF00-\u{10FFFF}`;
// The limits are the RFC's, and what keeps this linear with no boundary to start from.
// `u` makes them count code points, as Swift and Kotlin do.
const EMAIL_RE = new RegExp(
  String.raw`[A-Za-z0-9._%+\-${EMAIL_NON_ASCII}]{1,64}@[A-Za-z0-9.\-${EMAIL_NON_ASCII}]{1,255}\.[A-Za-z${EMAIL_NON_ASCII}]{2,}`,
  "gu",
);

/**
 * Max serialized request body size accepted by the ingest endpoint: 50 KB.
 * Mirrors MAX_REQUEST_BODY_SIZE_BYTES in @trackless/shared-config.
 */
const MAX_REQUEST_BODY_SIZE_BYTES = 50 * 1024;

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
export const Severity = {
  /** @deprecated Nothing reads `debug` — it is sent as `info`. Call `Trackless.info(name, detail?)`. */
  DEBUG: "debug",
  /** @deprecated Call `Trackless.info(name, detail?)` instead of passing this to `error()`. */
  INFO: "info",
  /** @deprecated Nothing reads `warning` — it is sent as `error`. Call `Trackless.error(name, code?)`. */
  WARNING: "warning",
  /** The level `error()` sends. Passing it explicitly is redundant. */
  ERROR: "error",
  /** @deprecated Nothing reads `fatal` — it is sent as `error`. Call `Trackless.error(name, code?)`. */
  FATAL: "fatal",
} as const satisfies Record<string, ErrorSeverity>;

/**
 * Runtime set of the five severities installed SDKs may send. Used only to tell
 * a legacy `error(name, severity, code?)` call from an `error(name, code?)` one.
 */
const VALID_SEVERITIES: ReadonlySet<string> = new Set(Object.values(Severity));

/** The two levels this SDK sends, and the ingest endpoint stores. */
type StoredSeverity = Extract<ErrorSeverity, "error" | "info">;

/**
 * Map a severity a caller passed to the one that goes on the wire. Mirrors
 * `storedSeverity()` in `@trackless/shared-config`, which ingest applies on the
 * write path — the SDK is zero-dependency, so the two lines live twice on
 * purpose. `info` and `debug` become `info`; everything else, including a
 * missing or unrecognized value, becomes `error`.
 */
function storedSeverity(sent: string | undefined): StoredSeverity {
  return sent === "info" || sent === "debug" ? "info" : "error";
}

/**
 * Everything a `configure()` call resolves to except `onError`, which is a
 * function and cannot be compared meaningfully. Two calls that resolve to equal
 * settings describe the same running configuration.
 */
interface ResolvedSettings {
  apiKey: string;
  endpoint: string;
  environment: Environment;
  enabled: boolean;
  flushIntervalSeconds: number;
  autoScreenTracking: boolean;
  debugLogging: boolean;
  suppressWarnings: boolean;
  appVersion: string | undefined;
  buildNumber: string | undefined;
  measureLaunch: boolean;
  launchThresholdSeconds: number | undefined;
  detectHangs: boolean;
  captureUncaught: boolean;
}

/**
 * Where one flush sends its events: the buffer it drains and the key,
 * endpoint, environment, context and circuit breaker it sends them under.
 * Captured when the flush starts, so a `configure()` that lands while a flush
 * is awaiting the network cannot send the previous key's events under the new
 * one.
 */
interface FlushTarget {
  buffer: EventBuffer;
  circuitBreaker: CircuitBreaker;
  apiKey: string;
  endpoint: string;
  environment: Environment;
  context: EventContext;
}

export class Trackless {
  private static apiKey: string = "";
  private static endpoint: string = "";
  private static environment: Environment = "production";
  private static onError: (error: Error) => void = () => {};
  private static flushIntervalSeconds: number = DEFAULT_FLUSH_INTERVAL_SECONDS;
  private static autoScreenTracking: boolean = false;
  private static debugLogging: boolean = false;
  private static suppressWarnings: boolean = false;
  /** Raw `appVersion` / `buildNumber` as configured, kept to compare repeat `configure()` calls. */
  private static appVersion: string | undefined = undefined;
  private static buildNumber: string | undefined = undefined;
  private static measureLaunch = false;
  private static launchThresholdSeconds: number | undefined = undefined;
  private static detectHangs = false;
  private static captureUncaught = false;

  private static enabled: boolean = false;
  private static destroyed = false;
  private static configured = false;

  /** One-shot flag: warn at most once per session when the buffer rejects an event. */
  private static bufferFullWarned = false;
  /** One-shot flag: warn at most once when events are recorded while unconfigured. */
  private static preConfigureWarned = false;

  private static buffer: EventBuffer = new EventBuffer();
  private static circuitBreaker: CircuitBreaker = new CircuitBreaker();
  private static context: EventContext = { platform: "web" };
  private static session: SessionManager = new SessionManager();
  private static funnels: FunnelTracker = new FunnelTracker();
  /** Per-session first-use set backing feature-reach `firstUses` marking. Reset on session end. */
  private static featureReach: FeatureReachTracker = new FeatureReachTracker();
  /** Per-session first-occurrence set backing error-reach `firstOccurrences` marking. Reset on session end. */
  private static errorReach: ErrorReachTracker = new ErrorReachTracker();
  /**
   * Open timers. Not replaced on `configure()`, so a timer started before the
   * first configure survives it; a reconfigure discards them through
   * `endCurrentSession()`.
   */
  private static timers: OpenTimers = new OpenTimers();
  /** The `measureLaunch` probe. Never replaced, so it measures once per page load. */
  private static launch: LaunchProbe = new LaunchProbe();
  /** The `detectHangs` long-task observer, running only while the page is visible. */
  private static hangs: HangObserver = new HangObserver();
  /** The `captureUncaught` window listeners, attached only while recording. */
  private static uncaught: UncaughtListener = new UncaughtListener();
  /** One-shot flag: the reserved-prefix warning is logged once per page load. */
  private static reservedPrefixWarned = false;

  private static flushTimer: ReturnType<typeof setInterval> | null = null;
  private static visibilityHandler: (() => void) | null = null;
  private static popstateHandler: (() => void) | null = null;
  private static hashchangeHandler: (() => void) | null = null;
  private static originalPushState: typeof history.pushState | null = null;

  /** Per-route screen view deduplication: "name" or "name|detail" -> last recorded timestamp */
  private static screenViewCooldowns: Map<string, number> = new Map();

  /** Whether the SDK has been configured and is ready to record events. */
  static get isConfigured(): boolean {
    return Trackless.configured && !Trackless.destroyed;
  }

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
  static configure(config: TracklessConfig): void {
    try {
      const settings: ResolvedSettings = {
        apiKey: config.apiKey,
        endpoint: config.endpoint ?? DEFAULT_ENDPOINT,
        environment: config.environment ?? defaultEnvironment(),
        enabled: config.enabled ?? true,
        flushIntervalSeconds: config.flushIntervalSeconds ?? DEFAULT_FLUSH_INTERVAL_SECONDS,
        autoScreenTracking: config.autoScreenTracking ?? false,
        debugLogging: config.debugLogging ?? false,
        suppressWarnings: config.suppressWarnings ?? false,
        appVersion: config.appVersion,
        buildNumber: config.buildNumber,
        measureLaunch: config.measureLaunch ?? false,
        launchThresholdSeconds: Trackless.validThreshold(config.launchThresholdSeconds),
        detectHangs: config.detectHangs ?? false,
        captureUncaught: config.captureUncaught ?? false,
      };

      let reconfigured = false;
      if (Trackless.isConfigured) {
        if (Trackless.matchesRunningSettings(settings)) {
          Trackless.onError = config.onError ?? (() => {});
          Trackless.debug("configure — settings unchanged, keeping the current session");
          return;
        }
        Trackless.retireRunningConfiguration();
        reconfigured = true;
      }

      Trackless.apiKey = settings.apiKey;
      Trackless.endpoint = settings.endpoint;
      Trackless.environment = settings.environment;
      Trackless.enabled = settings.enabled;
      Trackless.onError = config.onError ?? (() => {});
      Trackless.flushIntervalSeconds = settings.flushIntervalSeconds;
      Trackless.autoScreenTracking = settings.autoScreenTracking;
      Trackless.debugLogging = settings.debugLogging;
      Trackless.suppressWarnings = settings.suppressWarnings;
      Trackless.appVersion = settings.appVersion;
      Trackless.buildNumber = settings.buildNumber;
      Trackless.measureLaunch = settings.measureLaunch;
      Trackless.launchThresholdSeconds = settings.launchThresholdSeconds;
      Trackless.detectHangs = settings.detectHangs;
      Trackless.captureUncaught = settings.captureUncaught;

      Trackless.buffer = new EventBuffer();
      Trackless.circuitBreaker = new CircuitBreaker();
      Trackless.context = detectContext(settings.appVersion, settings.buildNumber);
      Trackless.session = new SessionManager();
      Trackless.funnels = new FunnelTracker();
      Trackless.featureReach = new FeatureReachTracker();
      Trackless.errorReach = new ErrorReachTracker();
      Trackless.screenViewCooldowns = new Map();
      Trackless.bufferFullWarned = false;
      Trackless.preConfigureWarned = false;
      Trackless.destroyed = false;
      Trackless.configured = true;

      if (reconfigured) {
        Trackless.debug(
          "reconfigured — previous session ended and flushed under the previous settings",
        );
      }
      Trackless.debug(
        `configured — env=${Trackless.environment} endpoint=${Trackless.endpoint} flush=${Trackless.flushIntervalSeconds}s`,
      );
      if (
        config.launchThresholdSeconds !== undefined &&
        settings.launchThresholdSeconds === undefined
      ) {
        Trackless.warn(
          "launchThresholdSeconds is not a positive number — trackless.launch is sent without a threshold",
        );
      }

      if (Trackless.enabled) {
        // Start session
        Trackless.startNewSession();

        Trackless.startPeriodicFlush();
        Trackless.addVisibilityListener();
        if (Trackless.autoScreenTracking) {
          Trackless.setupAutoScreenTracking();
        }
        Trackless.startHangsIfVisible();
        Trackless.startUncaughtIfWanted();
      }
      // After recording is set up: when `load` has already fired the launch is
      // read, and sent, right here.
      if (settings.measureLaunch) {
        Trackless.launch.arm((seconds) => Trackless.deliverLaunch(seconds));
      }
    } catch {
      Trackless.enabled = false;
    }
  }

  /** Record a view event. */
  static view(name: string, detail?: string): void {
    try {
      if (!Trackless.canRecord()) return;
      const normalized = Trackless.normalizeName(name);
      if (!normalized) return;

      const normalizedDetail =
        detail !== undefined ? Trackless.normalizeField(detail, EVENT_NAME_MAX_LENGTH) : undefined;
      Trackless.session.recordActivity();
      Trackless.addEvent({
        type: "view",
        name: normalized,
        ...(normalizedDetail ? { detail: normalizedDetail } : {}),
      });
      Trackless.debug(
        `view — ${normalized}${normalizedDetail ? ` detail=${normalizedDetail}` : ""}`,
      );
      Trackless.checkFlushThreshold();
    } catch {
      // Never throws
    }
  }

  /** Record a feature usage event. */
  static feature(name: string, detail?: string): void {
    try {
      if (!Trackless.canRecord()) return;
      const normalized = Trackless.normalizeName(name);
      if (!normalized) return;

      const normalizedDetail =
        detail !== undefined ? Trackless.normalizeField(detail, EVENT_NAME_MAX_LENGTH) : undefined;
      Trackless.session.recordActivity();
      // Mark the first use of this feature name within the session (reach dedup).
      // Keyed on the normalized name only — not name+detail — so a session using
      // several variants of one feature contributes a single first use.
      const isFirstUse = Trackless.featureReach.firstUse(normalized);
      Trackless.addEvent({
        type: "feature",
        name: normalized,
        ...(normalizedDetail ? { detail: normalizedDetail } : {}),
        ...(isFirstUse ? { firstUses: 1 } : {}),
      });
      Trackless.debug(
        `feature — ${normalized}${normalizedDetail ? ` detail=${normalizedDetail}` : ""}${
          isFirstUse ? " (first use)" : ""
        }`,
      );
      Trackless.checkFlushThreshold();
    } catch {
      // Never throws
    }
  }

  /** Record a funnel step. */
  static funnel(funnelName: string, stepIndex: number, stepName: string): void {
    try {
      if (!Trackless.canRecord()) return;
      if (typeof stepIndex !== "number" || !Number.isInteger(stepIndex) || stepIndex < 0) return;
      const normalizedFunnel = Trackless.normalizeName(funnelName);
      const normalizedStep = Trackless.normalizeName(stepName);
      if (!normalizedFunnel || !normalizedStep) return;

      if (!Trackless.funnels.step(normalizedFunnel, stepIndex)) {
        Trackless.debug(`funnel — ${normalizedFunnel}/${normalizedStep} (duplicate, skipped)`);
        return;
      }

      Trackless.session.recordActivity();
      Trackless.addEvent({
        type: "funnel",
        name: normalizedFunnel,
        step: normalizedStep,
        stepIndex,
      });
      Trackless.debug(`funnel — ${normalizedFunnel}/${normalizedStep} step=${stepIndex}`);
      Trackless.checkFlushThreshold();
    } catch {
      // Never throws
    }
  }

  /**
   * Record a performance measurement.
   *
   * Names starting with `trackless.` are reserved for the metrics the SDK
   * measures itself (`trackless.launch`, `trackless.hang`). Passing one logs a
   * warning once per page load; the measurement is still sent.
   */
  static performance(name: string, durationSeconds: number, thresholdSeconds?: number): void {
    try {
      if (!Trackless.canRecord()) return;
      const normalized = Trackless.normalizeName(name);
      if (!normalized) return;
      Trackless.warnIfReserved(normalized);
      if (typeof durationSeconds !== "number" || durationSeconds < 0) return;
      if (
        thresholdSeconds !== undefined &&
        (typeof thresholdSeconds !== "number" || thresholdSeconds <= 0)
      )
        return;

      Trackless.session.recordActivity();
      Trackless.addEvent({
        type: "performance",
        name: normalized,
        duration: durationSeconds,
        ...(thresholdSeconds !== undefined ? { threshold: thresholdSeconds } : {}),
      });
      Trackless.debug(
        `performance — ${normalized} duration=${durationSeconds}s${thresholdSeconds !== undefined ? ` threshold=${thresholdSeconds}s` : ""}`,
      );
      Trackless.checkFlushThreshold();
    } catch {
      // Never throws
    }
  }

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
  static startTimer(name: string): void {
    try {
      const normalized = Trackless.normalizeName(name);
      if (!normalized) return;
      Trackless.warnIfReserved(normalized);
      const result = Trackless.timers.start(normalized);
      if (typeof result === "object" && result.shouldWarn) {
        Trackless.warn(
          `timer "${normalized}" not started — ${MAX_OPEN_TIMERS} timers are already open (logged once per session)`,
        );
      }
    } catch {
      // Never throws
    }
  }

  /**
   * Stop the timer `name` and send its elapsed time, in seconds, as
   * `performance(name, elapsed, thresholdSeconds)`.
   *
   * Does nothing when no timer of that name is open: never started, already
   * stopped or cancelled, or discarded when the session ended. An elapsed time
   * below zero or above a day is dropped.
   */
  static stopTimer(name: string, thresholdSeconds?: number): void {
    try {
      const normalized = Trackless.normalizeField(name, EVENT_NAME_MAX_LENGTH);
      if (!normalized) return;
      const elapsed = Trackless.timers.stop(normalized);
      if (elapsed === null) return;
      Trackless.recordTimer(normalized, elapsed, thresholdSeconds);
    } catch {
      // Never throws
    }
  }

  /**
   * Drop the timer `name` without sending anything — the operation was
   * abandoned, or failed in a way its duration should not describe.
   */
  static cancelTimer(name: string): void {
    try {
      const normalized = Trackless.normalizeField(name, EVENT_NAME_MAX_LENGTH);
      if (normalized) Trackless.timers.cancel(normalized);
    } catch {
      // Never throws
    }
  }

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
  static measure<T>(
    name: string,
    fn: () => T | Promise<T>,
    thresholdSeconds?: number,
  ): T | Promise<T> {
    let start: TimerStart | null = null;
    try {
      start = Trackless.timers.mark();
    } catch {
      // Never throws — fn still runs, unmeasured
    }
    const result = fn();
    if (Trackless.isThenable(result)) {
      return Promise.resolve(result).then((value) => {
        Trackless.finishMeasure(name, start, thresholdSeconds);
        return value;
      });
    }
    Trackless.finishMeasure(name, start, thresholdSeconds);
    return result;
  }

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
  static error(name: string, severityOrCode?: string, code?: string): void {
    // One positional slot, two meanings: a legacy call passes one of the five
    // severity strings, a current one passes the code. Anything that is not a
    // severity is the code, so `error("api_timeout", "TIMEOUT_500")` records
    // the code rather than warning about an unknown severity.
    const isSeverity = severityOrCode !== undefined && VALID_SEVERITIES.has(severityOrCode);
    Trackless.recordErrorEvent(
      name,
      isSeverity ? storedSeverity(severityOrCode) : "error",
      isSeverity ? code : (code ?? severityOrCode),
    );
  }

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
  static info(name: string, detail?: string): void {
    Trackless.recordErrorEvent(name, "info", detail);
  }

  /**
   * Shared path behind `error()`, `info()` and `captureUncaught`: same
   * normalization, PII guard, session-reach marker and rollup key. `severity` is
   * already mapped to one of the two stored levels, so the buffer's rollup key
   * collapses one name reported at several legacy severities into a single
   * entry. A developer's call (`fromSdk` false) warns on a reserved name and
   * counts toward the session's depth; the SDK's own send does neither.
   */
  private static recordErrorEvent(
    name: string,
    severity: StoredSeverity,
    code: string | undefined,
    fromSdk = false,
  ): void {
    try {
      if (!Trackless.canRecord()) return;
      const normalized = Trackless.normalizeName(name);
      if (!normalized) return;

      const normalizedCode =
        code !== undefined ? Trackless.normalizeField(code, EVENT_NAME_MAX_LENGTH) : undefined;
      if (!fromSdk) {
        Trackless.warnIfReserved(normalized, severity);
        Trackless.session.recordActivity();
      }
      // Mark the first occurrence of this name within the session (reach
      // dedup). Keyed on the normalized name only — not name+severity+code — so
      // a session reporting one name at several codes contributes a single first
      // occurrence. `error()` and `info()` share the tracker, which is why a
      // name must not be shared between them.
      const isFirstOccurrence = Trackless.errorReach.firstOccurrence(normalized);
      Trackless.addEvent({
        type: "error",
        name: normalized,
        severity,
        ...(normalizedCode ? { code: normalizedCode } : {}),
        ...(isFirstOccurrence ? { firstOccurrences: 1 } : {}),
      });
      Trackless.debug(
        `${severity} — ${normalized}${normalizedCode ? ` code=${normalizedCode}` : ""}${
          isFirstOccurrence ? " (first occurrence)" : ""
        }`,
      );
      Trackless.checkFlushThreshold();
    } catch {
      // Never throws
    }
  }

  private static isThenable<T>(value: T | Promise<T>): value is Promise<T> {
    return (
      value !== null &&
      (typeof value === "object" || typeof value === "function") &&
      typeof (value as { then?: unknown }).then === "function"
    );
  }

  /** Send the measurement for one `measure()` call whose `fn` finished normally. */
  private static finishMeasure(
    name: string,
    start: TimerStart | null,
    thresholdSeconds: number | undefined,
  ): void {
    try {
      if (!start) return;
      const elapsed = Trackless.timers.elapsedSince(start);
      if (elapsed === null) return;
      const normalized = Trackless.normalizeName(name);
      if (!normalized) return;
      Trackless.warnIfReserved(normalized);
      Trackless.recordTimer(normalized, elapsed, thresholdSeconds);
    } catch {
      // Never throws
    }
  }

  /**
   * The send behind `stopTimer()` and `measure()`: `performance()` with an
   * elapsed time the SDK measured, under a name that is already normalized.
   */
  private static recordTimer(
    normalized: string,
    elapsedSeconds: number,
    thresholdSeconds: number | undefined,
  ): void {
    if (!Trackless.canRecord()) return;
    if (!(elapsedSeconds >= 0 && elapsedSeconds <= MAX_TIMER_ELAPSED_SECONDS)) {
      Trackless.warn(
        `dropped performance "${normalized}" — timer elapsed time ${elapsedSeconds}s is outside 0–${MAX_TIMER_ELAPSED_SECONDS}s`,
      );
      return;
    }
    if (
      thresholdSeconds !== undefined &&
      (typeof thresholdSeconds !== "number" || thresholdSeconds <= 0)
    )
      return;

    Trackless.session.recordActivity();
    Trackless.addEvent({
      type: "performance",
      name: normalized,
      duration: elapsedSeconds,
      ...(thresholdSeconds !== undefined ? { threshold: thresholdSeconds } : {}),
    });
    Trackless.debug(
      `performance — ${normalized} duration=${elapsedSeconds}s${thresholdSeconds !== undefined ? ` threshold=${thresholdSeconds}s` : ""} (timer)`,
    );
    Trackless.checkFlushThreshold();
  }

  /**
   * Warn once per page load when a developer's normalized name has the
   * reserved prefix. `kind` names the call in the message.
   */
  private static warnIfReserved(
    normalized: string,
    kind: "performance" | StoredSeverity = "performance",
  ): void {
    if (!normalized.startsWith(RESERVED_NAME_PREFIX) || Trackless.reservedPrefixWarned) return;
    Trackless.reservedPrefixWarned = true;
    Trackless.warn(
      `${kind} name "${normalized}" starts with "${RESERVED_NAME_PREFIX}", which is reserved for names the SDK sends itself — sent anyway (logged once)`,
    );
  }

  /** A positive, finite threshold, or undefined. */
  private static validThreshold(value: number | undefined): number | undefined {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
  }

  /** Recording, without the pre-configure warning `canRecord()` logs. */
  private static isRecording(): boolean {
    return Trackless.enabled && !Trackless.destroyed && Trackless.configured;
  }

  /**
   * Send the launch time the probe measured — only while recording with
   * `measureLaunch` on. A launch measured while recording is disabled, or
   * after a reconfigure turned the option off, is dropped.
   */
  private static deliverLaunch(seconds: number): void {
    try {
      if (!Trackless.isRecording() || !Trackless.measureLaunch) return;
      Trackless.recordSdkMetric(LAUNCH_METRIC, seconds, Trackless.launchThresholdSeconds);
    } catch {
      // Never throws
    }
  }

  /** Start the long-task observer when `detectHangs` is on and the page is visible. */
  private static startHangsIfVisible(): void {
    if (!Trackless.detectHangs) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    Trackless.hangs.start((seconds) => {
      if (Trackless.isRecording() && Trackless.detectHangs) {
        Trackless.recordSdkMetric(HANG_METRIC, seconds, undefined);
      }
    });
  }

  /**
   * Attach the `captureUncaught` listeners when the option is on. Each
   * uncaught error or rejection is recorded as `error("trackless.uncaught",
   * <name>)`; a name normalization rejects is sent as `unknown`.
   */
  private static startUncaughtIfWanted(): void {
    if (!Trackless.captureUncaught) return;
    Trackless.uncaught.start((code) => {
      if (!Trackless.isRecording() || !Trackless.captureUncaught) return;
      const normalizedCode =
        Trackless.normalizeField(code, EVENT_NAME_MAX_LENGTH) ?? UNCAUGHT_UNKNOWN_CODE;
      Trackless.recordErrorEvent(UNCAUGHT_ERROR, "error", normalizedCode, true);
    });
  }

  /**
   * Buffer one metric the SDK measured itself. Same bounds as a timer; no
   * reserved-name warning, and no session activity — it describes the page,
   * not anything the user did.
   */
  private static recordSdkMetric(
    name: string,
    seconds: number,
    thresholdSeconds: number | undefined,
  ): void {
    if (!(seconds >= 0 && seconds <= MAX_TIMER_ELAPSED_SECONDS)) {
      Trackless.warn(
        `dropped performance "${name}" — measured ${seconds}s is outside 0–${MAX_TIMER_ELAPSED_SECONDS}s`,
      );
      return;
    }
    Trackless.addEvent({
      type: "performance",
      name,
      duration: seconds,
      ...(thresholdSeconds !== undefined ? { threshold: thresholdSeconds } : {}),
    });
    Trackless.debug(
      `performance — ${name} duration=${seconds}s${thresholdSeconds !== undefined ? ` threshold=${thresholdSeconds}s` : ""} (SDK)`,
    );
    Trackless.checkFlushThreshold();
  }

  /** Force flush pending events to the ingest endpoint. */
  static async flush(): Promise<void> {
    try {
      await Trackless.performFlush(false);
    } catch {
      // Never throws
    }
  }

  /**
   * Toggle event recording. Disabling discards buffered data and drops the
   * session without sending its end; enabling again starts a new session.
   */
  static setEnabled(isEnabled: boolean): void {
    try {
      Trackless.debug(`setEnabled — ${isEnabled}`);
      Trackless.enabled = isEnabled;
      if (!isEnabled) {
        // Drop the session rather than end it: an opt-out must not lead to a later send.
        Trackless.timers.discardAll();
        Trackless.buffer.clear();
        Trackless.session.destroy();
        Trackless.funnels.clear();
        Trackless.featureReach.clear();
        Trackless.errorReach.clear();
        Trackless.stopPeriodicFlush();
        Trackless.removeVisibilityListener();
        Trackless.teardownAutoScreenTracking();
        Trackless.hangs.stop();
        Trackless.uncaught.stop();
      } else if (!Trackless.destroyed && Trackless.configured) {
        Trackless.startNewSession();
        Trackless.startPeriodicFlush();
        Trackless.addVisibilityListener();
        if (Trackless.autoScreenTracking) {
          Trackless.setupAutoScreenTracking();
        }
        Trackless.startHangsIfVisible();
        Trackless.startUncaughtIfWanted();
      }
    } catch {
      // Never throws
    }
  }

  /** End the session, flush remaining events and clean up. Events are dropped until `configure()` is called again. */
  static async destroy(): Promise<void> {
    try {
      if (Trackless.destroyed) return;
      Trackless.debug("destroying");
      Trackless.destroyed = true;

      Trackless.endCurrentSession();
      await Trackless.performFlush(false);

      Trackless.stopPeriodicFlush();
      Trackless.removeVisibilityListener();
      Trackless.teardownAutoScreenTracking();
      Trackless.hangs.stop();
      Trackless.uncaught.stop();
      Trackless.screenViewCooldowns.clear();
      Trackless.funnels.clear();
      Trackless.featureReach.clear();
      Trackless.errorReach.clear();
      Trackless.session.destroy();
      Trackless.configured = false;
    } catch {
      // Never throws
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────

  /**
   * Whether `settings` match the running configuration. `enabled` is compared
   * with the live state, so a configure() after `setEnabled(false)` that asks
   * for recording is a change, not a no-op.
   */
  private static matchesRunningSettings(settings: ResolvedSettings): boolean {
    return (
      settings.apiKey === Trackless.apiKey &&
      settings.endpoint === Trackless.endpoint &&
      settings.environment === Trackless.environment &&
      settings.enabled === Trackless.enabled &&
      settings.flushIntervalSeconds === Trackless.flushIntervalSeconds &&
      settings.autoScreenTracking === Trackless.autoScreenTracking &&
      settings.debugLogging === Trackless.debugLogging &&
      settings.suppressWarnings === Trackless.suppressWarnings &&
      settings.appVersion === Trackless.appVersion &&
      settings.buildNumber === Trackless.buildNumber &&
      settings.measureLaunch === Trackless.measureLaunch &&
      settings.launchThresholdSeconds === Trackless.launchThresholdSeconds &&
      settings.detectHangs === Trackless.detectHangs &&
      settings.captureUncaught === Trackless.captureUncaught
    );
  }

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
  private static retireRunningConfiguration(): void {
    // The running configuration's timers end with it, recording or not.
    Trackless.timers.discardAll();
    if (Trackless.enabled) {
      Trackless.endCurrentSession();
      Trackless.performFlush(false, Trackless.currentFlushTarget()).catch(() => {});
    }
    Trackless.stopPeriodicFlush();
    Trackless.removeVisibilityListener();
    Trackless.teardownAutoScreenTracking();
    Trackless.hangs.stop();
    Trackless.uncaught.stop();
  }

  /** The running configuration's buffer and send settings, captured now. */
  private static currentFlushTarget(): FlushTarget {
    return {
      buffer: Trackless.buffer,
      circuitBreaker: Trackless.circuitBreaker,
      apiKey: Trackless.apiKey,
      endpoint: Trackless.endpoint,
      environment: Trackless.environment,
      context: Trackless.context,
    };
  }

  private static canRecord(): boolean {
    if (!Trackless.configured && !Trackless.preConfigureWarned) {
      Trackless.preConfigureWarned = true;
      Trackless.warn("event dropped — SDK is not configured (call Trackless.configure() first)");
    }
    return Trackless.enabled && !Trackless.destroyed && Trackless.configured;
  }

  /**
   * Normalize an event field (name, detail, step, code) into a valid format.
   * Strips PII, lowercases, replaces invalid chars with underscores, and validates.
   * Returns null if the result is empty or matches an abuse pattern.
   *
   * The abuse patterns run on the whole value before the PII strip as well as on
   * the result: the phone pattern eats runs of digits inside a UUID or hex ID, and
   * truncating can cut one short, either of which leaves a part no rule matches.
   */
  private static normalizeField(value: string, maxLength: number): string | null {
    if (typeof value !== "string") return null;
    if (Trackless.isAbusePattern(Trackless.sanitizeField(value))) return null;
    let result = Trackless.sanitizeField(Trackless.stripPII(value));
    if (!result) return null;
    // Truncate to max length; a cut can leave a trailing `.`, which ingest rejects
    if (result.length > maxLength) result = result.slice(0, maxLength).replace(/[_.]+$/, "");
    return Trackless.isAbusePattern(result) ? null : result;
  }

  /** Lowercases and reduces a value to the characters and shape a field allows. */
  private static sanitizeField(value: string): string {
    return (
      value
        .toLowerCase()
        // Replace runs of non-allowed chars with a single underscore
        .replace(/[^a-z0-9._-]+/g, "_")
        // Trim leading/trailing underscores and dots
        .replace(/^[_.]+|[_.]+$/g, "")
        // Collapse consecutive dots
        .replace(/\.{2,}/g, ".")
    );
  }

  /** True when a sanitized field looks like an identifier and must not be sent. */
  private static isAbusePattern(value: string): boolean {
    return (
      Trackless.UUID_REGEX.test(value) ||
      Trackless.LONG_HEX_REGEX.test(value) ||
      Trackless.LONG_NUMERIC_REGEX.test(value) ||
      Trackless.ALL_HEX_REGEX.test(value) ||
      Trackless.hasRedactedIdResidue(value)
    );
  }

  /** The PII marker beside 8+ characters of hex-only tokens: what remains of an ID. */
  private static hasRedactedIdResidue(value: string): boolean {
    if (!value.includes("redacted")) return false;
    let hexChars = 0;
    for (const token of value.split(/redacted|[-_.]+/)) {
      if (/^[0-9a-f]+$/.test(token)) hexChars += token.length;
    }
    return hexChars >= 8;
  }

  private static debug(msg: string): void {
    if (Trackless.debugLogging) console.log(`[Trackless] ${msg}`);
  }

  private static warn(msg: string): void {
    if (!Trackless.suppressWarnings) console.warn(`[Trackless] ${msg}`);
  }

  private static addEvent(event: TracklessEvent): void {
    if (!Trackless.buffer.add(event) && !Trackless.bufferFullWarned) {
      Trackless.bufferFullWarned = true;
      Trackless.warn("event buffer full — new events are dropped until the next flush");
    }
  }

  /**
   * Strip PII patterns (emails, SSNs, phone numbers) from a string,
   * replacing matches with [REDACTED].
   *
   * Swift and Kotlin spell out what `\b` means in the SSN patterns, ASCII letters, digits and
   * `_`, because their regex engines do not agree with it. Those patterns stay without the `u`
   * flag, and nothing here uses lookbehind: it is a syntax error before Safari 16.4 and the SDK
   * would not load.
   */
  private static stripPII(value: string): string {
    // Email addresses
    let result = value.includes("@") ? value.replace(EMAIL_RE, "[REDACTED]") : value;
    // SSN patterns (check before phone numbers to avoid false matches)
    result = result.replace(/\b[0-9]{3}-[0-9]{2}-[0-9]{4}\b/g, "[REDACTED]");
    result = result.replace(/\b[0-9]{9}\b/g, "[REDACTED]");
    // Phone numbers: a digit, then 8+ mixed digit/separator chars, ending with a digit
    result = result.replace(
      // eslint-disable-next-line no-control-regex -- \x0B: the one spelling all four engines read as a vertical tab
      /\+?[0-9][0-9\t\n\x0B\f\r \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF\-.()]{8,}[0-9]/g,
      "[REDACTED]",
    );
    return result;
  }

  /**
   * A UUID anywhere in the value, by its first four groups (8-4-4-4) so one with its
   * tail cut off is found too, with any run of hyphens, underscores or dots between them
   */
  private static readonly UUID_REGEX =
    /[0-9a-f]{8}[-_.]+[0-9a-f]{4}[-_.]+[0-9a-f]{4}[-_.]+[0-9a-f]{4}/;
  /** 24 or more consecutive hex characters anywhere in the value */
  private static readonly LONG_HEX_REGEX = /[0-9a-f]{24,}/;
  /** Numeric-only strings > 12 characters */
  private static readonly LONG_NUMERIC_REGEX = /^[0-9]{13,}$/;
  /** Entirely hex characters and longer than 16 characters */
  private static readonly ALL_HEX_REGEX = /^[0-9a-f]{17,}$/;

  /** 6+ digit numeric ID in a URL path segment */
  private static readonly LONG_NUMERIC_RE = /^\d{6,}$/;
  /** 12+ hex chars in a URL path segment (MongoDB ObjectIDs, short hashes) */
  private static readonly LONG_HEX_RE = /^[0-9a-f]{12,}$/i;

  /**
   * Lowercase words of 1-20 letters with up to 3 trailing digits, joined by one `-` or `_`.
   * A word after the first may instead be a number of up to 4 digits.
   */
  private static readonly ANCHOR_RE =
    /^[a-z]{1,20}[0-9]{0,3}(?:[-_](?:[a-z]{1,20}[0-9]{0,3}|[0-9]{1,4}))*$/;
  private static readonly ANCHOR_MAX_LENGTH = 64;

  private static normalizeName(name: string): string | null {
    const normalized = Trackless.normalizeField(name, EVENT_NAME_MAX_LENGTH);
    if (!normalized) {
      Trackless.warn(`event name rejected — ${INVALID_EVENT_NAME_REASON}`);
      Trackless.onError(new Error(`Invalid event name — ${INVALID_EVENT_NAME_REASON}`));
      return null;
    }
    return normalized;
  }

  private static startNewSession(): void {
    if (Trackless.session.start()) {
      Trackless.addEvent({ type: "session", name: "start" });
      Trackless.debug("session started");
    }
  }

  private static endCurrentSession(): void {
    // Before the session check: a reconfigure or destroy() after
    // setEnabled(false) has no session to end, but may still hold timers
    // started since.
    Trackless.timers.discardAll();
    const result = Trackless.session.end();
    if (result) {
      Trackless.funnels.clear();
      Trackless.featureReach.clear();
      Trackless.errorReach.clear();
      Trackless.addEvent({
        type: "session",
        name: "end",
        duration: result.duration,
        stepIndex: result.depth,
      });
      Trackless.debug(`session ended — duration=${result.duration}s depth=${result.depth}`);
    }
  }

  private static checkFlushThreshold(): void {
    if (Trackless.buffer.totalSize >= BUFFER_FLUSH_THRESHOLD) {
      Trackless.performFlush(false).catch(() => {});
    }
  }

  /**
   * Drain `target`'s buffer and send it. `target` defaults to the running
   * configuration, captured when the flush starts; every payload of this flush
   * goes out under that capture even if `configure()` changes the key while
   * an earlier payload is in flight. `keepalive` is set only by the page-hide
   * flush, so the request can outlive the page.
   */
  private static async performFlush(
    keepalive: boolean,
    target: FlushTarget = Trackless.currentFlushTarget(),
  ): Promise<void> {
    const { buffer, circuitBreaker } = target;
    if (buffer.isEmpty) return;
    if (!circuitBreaker.canAttempt()) {
      Trackless.debug("flush skipped — circuit breaker open");
      return;
    }

    const payloads = buffer
      .drain(target.environment, target.context)
      .flatMap((payload) => Trackless.splitToBodyLimit(payload));
    if (payloads.length === 0) return;

    for (const payload of payloads) {
      Trackless.debug(`flush — ${payload.events.length} events`);
      try {
        const result = await sendPayload(
          target.endpoint,
          target.apiKey,
          payload,
          FLUSH_TIMEOUT_MS,
          keepalive,
        );

        if (result.status >= 500) {
          circuitBreaker.recordFailure();
          Trackless.warn(`flush failed — status=${result.status}`);
          Trackless.onError(new Error(`Flush failed with status ${result.status}`));
        } else if (result.status >= 400) {
          // 4xx: discard batch, don't trigger circuit breaker
          Trackless.warn(`flush rejected — status=${result.status}`);
          Trackless.onError(new Error(`Flush rejected with status ${result.status}`));
        } else {
          circuitBreaker.recordSuccess();
          Trackless.debug(`flush success — status=${result.status}`);
        }
      } catch (error) {
        circuitBreaker.recordFailure();
        Trackless.warn("flush failed — network error");
        Trackless.onError(error instanceof Error ? error : new Error("Flush failed"));
      }
    }
  }

  /**
   * Split a payload into payloads whose serialized size fits the ingest
   * request body limit. Oversized payloads have their events halved
   * recursively; a single-event payload that still exceeds the limit is
   * dropped with a warning. The wire format is unchanged — only the
   * batching boundaries move.
   */
  private static splitToBodyLimit(payload: EventPayload): EventPayload[] {
    if (Trackless.payloadByteSize(payload) <= MAX_REQUEST_BODY_SIZE_BYTES) return [payload];

    if (payload.events.length <= 1) {
      Trackless.warn("event dropped — serialized payload exceeds the request body size limit");
      return [];
    }

    const mid = Math.ceil(payload.events.length / 2);
    return [
      ...Trackless.splitToBodyLimit({ ...payload, events: payload.events.slice(0, mid) }),
      ...Trackless.splitToBodyLimit({ ...payload, events: payload.events.slice(mid) }),
    ];
  }

  /** UTF-8 byte length of the serialized payload — matches the server-side Content-Length check. */
  private static payloadByteSize(payload: EventPayload): number {
    const json = JSON.stringify(payload);
    return typeof TextEncoder === "undefined" ? json.length : new TextEncoder().encode(json).length;
  }

  private static startPeriodicFlush(): void {
    if (Trackless.flushTimer !== null) return;
    Trackless.flushTimer = setInterval(() => {
      Trackless.performFlush(false).catch(() => {});
    }, Trackless.flushIntervalSeconds * 1000);
  }

  private static stopPeriodicFlush(): void {
    if (Trackless.flushTimer !== null) {
      clearInterval(Trackless.flushTimer);
      Trackless.flushTimer = null;
    }
  }

  private static addVisibilityListener(): void {
    if (Trackless.visibilityHandler !== null) return;
    if (typeof document === "undefined") return;

    Trackless.visibilityHandler = () => {
      if (document.visibilityState === "hidden") {
        Trackless.hangs.stop();
        Trackless.endCurrentSession();
        Trackless.performFlush(true).catch(() => {});
      } else if (document.visibilityState === "visible") {
        Trackless.startNewSession();
        Trackless.startHangsIfVisible();
      }
    };

    document.addEventListener("visibilitychange", Trackless.visibilityHandler);
  }

  private static removeVisibilityListener(): void {
    if (Trackless.visibilityHandler === null) return;
    if (typeof document === "undefined") return;

    document.removeEventListener("visibilitychange", Trackless.visibilityHandler);
    Trackless.visibilityHandler = null;
  }

  private static setupAutoScreenTracking(): void {
    if (typeof window === "undefined" || typeof history === "undefined") return;

    // Record initial screen view
    Trackless.recordScreenView();

    // Hook history.pushState
    if (!Trackless.originalPushState) {
      Trackless.originalPushState = history.pushState.bind(history);
      history.pushState = function (...args: Parameters<typeof history.pushState>) {
        Trackless.originalPushState!(...args);
        Trackless.recordScreenView();
      };
    }

    // Listen for popstate (back/forward navigation)
    if (!Trackless.popstateHandler) {
      Trackless.popstateHandler = () => {
        Trackless.recordScreenView();
      };
      window.addEventListener("popstate", Trackless.popstateHandler);
    }

    // Listen for hashchange (anchor navigation)
    if (!Trackless.hashchangeHandler) {
      Trackless.hashchangeHandler = () => {
        Trackless.recordScreenView();
      };
      window.addEventListener("hashchange", Trackless.hashchangeHandler);
    }
  }

  private static teardownAutoScreenTracking(): void {
    if (typeof window === "undefined") return;

    if (Trackless.originalPushState) {
      history.pushState = Trackless.originalPushState;
      Trackless.originalPushState = null;
    }

    if (Trackless.popstateHandler) {
      window.removeEventListener("popstate", Trackless.popstateHandler);
      Trackless.popstateHandler = null;
    }

    if (Trackless.hashchangeHandler) {
      window.removeEventListener("hashchange", Trackless.hashchangeHandler);
      Trackless.hashchangeHandler = null;
    }
  }

  private static recordScreenView(): void {
    try {
      if (!Trackless.canRecord()) return;

      const path = typeof window !== "undefined" ? window.location.pathname : "/";
      const screenName = Trackless.pathToScreenName(path);

      if (!EVENT_NAME_REGEX.test(screenName)) return;

      // A plain anchor becomes the detail ("#pricing" → "pricing"); any other hash is left out
      const hash =
        typeof window !== "undefined" ? (window.location.hash ?? "").replace(/^#/, "") : "";
      const detail = Trackless.isPlainAnchor(hash) ? hash : undefined;

      // Per-route deduplication keyed on name+detail
      const cooldownKey = detail ? `${screenName}|${detail}` : screenName;
      const now = Date.now();
      const lastRecorded = Trackless.screenViewCooldowns.get(cooldownKey);
      if (lastRecorded !== undefined && now - lastRecorded < SCREEN_VIEW_COOLDOWN_MS) {
        return;
      }

      Trackless.screenViewCooldowns.set(cooldownKey, now);
      Trackless.view(screenName, detail);
    } catch {
      // Never throws
    }
  }

  /**
   * Whether a URL hash reads as a section anchor. Browsers never send a hash to a
   * server, so it is where sign-in tokens, share keys and recovery links go, and the
   * SDK must not be what sends one. The shape is an allowlist because a left-out hash
   * costs little: the view still counts on its bare name, under that name's cooldown.
   */
  private static isPlainAnchor(hash: string): boolean {
    return hash.length <= Trackless.ANCHOR_MAX_LENGTH && Trackless.ANCHOR_RE.test(hash);
  }

  /**
   * Replace dynamic URL segments with `-id-`: anything the abuse patterns would
   * reject, so `/users/user-<uuid>/profile` is still counted as a view, plus the
   * shorter numeric and hex IDs below.
   */
  private static stripDynamicSegments(segments: string[]): string[] {
    return segments.map((seg) => {
      if (Trackless.isAbusePattern(seg.toLowerCase())) return "-id-";
      if (Trackless.LONG_NUMERIC_RE.test(seg)) return "-id-";
      if (Trackless.LONG_HEX_RE.test(seg)) return "-id-";
      return seg;
    });
  }

  /** Convert a URL path to a screen name */
  private static pathToScreenName(path: string): string {
    const stripped = path.replace(/^\//, "");
    if (!stripped) return "home";

    const segments = stripped.split("/").filter(Boolean);
    const cleaned = Trackless.stripDynamicSegments(segments);

    let result = cleaned.join("_");
    result = result.replace(/_+/g, "_");
    result = result.replace(/_$/, "");

    return result || "home";
  }
}
