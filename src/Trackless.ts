import type { TracklessConfig, EventContext } from "./types.js";
import type { TracklessEvent, Environment, ErrorSeverity } from "./types.js";
import { EventBuffer } from "./eventBuffer.js";
import { CircuitBreaker } from "./circuitBreaker.js";
import { detectContext } from "./context.js";
import { SessionManager } from "./session.js";
import { FunnelTracker } from "./funnel.js";
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
 * Lowercase alphanumeric, dots (for hierarchical grouping), underscores, hyphens.
 * 1-100 characters. No leading/trailing/consecutive dots.
 */
const EVENT_NAME_REGEX = /^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/;
const EVENT_NAME_MAX_LENGTH = 100;

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
 * Trackless.feature('export_clicked');
 * ```
 */
/** Error severity constants for use with `Trackless.error()`. */
export const Severity = {
  DEBUG: "debug",
  INFO: "info",
  WARNING: "warning",
  ERROR: "error",
  FATAL: "fatal",
} as const satisfies Record<string, ErrorSeverity>;

export class Trackless {
  private static apiKey: string = "";
  private static endpoint: string = "";
  private static environment: Environment = "production";
  private static onError: (error: Error) => void = () => {};
  private static flushIntervalSeconds: number = DEFAULT_FLUSH_INTERVAL_SECONDS;
  private static autoScreenTracking: boolean = false;
  private static debugLogging: boolean = false;
  private static suppressWarnings: boolean = false;

  private static enabled: boolean = false;
  private static destroyed = false;
  private static configured = false;

  private static buffer: EventBuffer = new EventBuffer();
  private static circuitBreaker: CircuitBreaker = new CircuitBreaker();
  private static context: EventContext = { platform: "web" };
  private static session: SessionManager = new SessionManager();
  private static funnels: FunnelTracker = new FunnelTracker();

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

  /** Configure the SDK and start a new session. */
  static configure(config: TracklessConfig): void {
    try {
      Trackless.apiKey = config.apiKey;
      Trackless.endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
      Trackless.environment = config.environment ?? "production";
      Trackless.enabled = config.enabled ?? true;
      Trackless.onError = config.onError ?? (() => {});
      Trackless.flushIntervalSeconds =
        config.flushIntervalSeconds ?? DEFAULT_FLUSH_INTERVAL_SECONDS;
      Trackless.autoScreenTracking = config.autoScreenTracking ?? false;
      Trackless.debugLogging = config.debugLogging ?? false;
      Trackless.suppressWarnings = config.suppressWarnings ?? false;

      Trackless.buffer = new EventBuffer();
      Trackless.circuitBreaker = new CircuitBreaker();
      Trackless.context = detectContext(config.appVersion, config.buildNumber);
      Trackless.session = new SessionManager();
      Trackless.funnels = new FunnelTracker();
      Trackless.screenViewCooldowns = new Map();
      Trackless.destroyed = false;
      Trackless.configured = true;

      Trackless.debug(
        `configured — env=${Trackless.environment} endpoint=${Trackless.endpoint} flush=${Trackless.flushIntervalSeconds}s`,
      );

      if (Trackless.enabled) {
        // Start session
        Trackless.startNewSession();

        Trackless.startPeriodicFlush();
        Trackless.addVisibilityListener();
        if (Trackless.autoScreenTracking) {
          Trackless.setupAutoScreenTracking();
        }
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
      if (!Trackless.isValidStringField(detail)) return;

      const strippedDetail = detail ? Trackless.stripPII(detail) : undefined;
      Trackless.session.recordActivity();
      Trackless.addEvent({
        type: "view",
        name: normalized,
        ...(strippedDetail ? { detail: strippedDetail } : {}),
      });
      Trackless.debug(`view — ${normalized}${detail ? ` detail=${detail}` : ""}`);
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
      if (!Trackless.isValidStringField(detail)) return;

      const strippedDetail = detail ? Trackless.stripPII(detail) : undefined;
      Trackless.session.recordActivity();
      Trackless.addEvent({
        type: "feature",
        name: normalized,
        ...(strippedDetail ? { detail: strippedDetail } : {}),
      });
      Trackless.debug(`feature — ${normalized}${detail ? ` detail=${detail}` : ""}`);
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

  /** Record a performance measurement. */
  static performance(name: string, durationSeconds: number, thresholdSeconds?: number): void {
    try {
      if (!Trackless.canRecord()) return;
      const normalized = Trackless.normalizeName(name);
      if (!normalized) return;
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

  /** Record an error event. */
  static error(name: string, severity: ErrorSeverity = "error", code?: string): void {
    try {
      if (!Trackless.canRecord()) return;
      const normalized = Trackless.normalizeName(name);
      if (!normalized) return;
      if (!Trackless.isValidStringField(code)) return;

      const strippedCode = code ? Trackless.stripPII(code) : undefined;
      Trackless.session.recordActivity();
      Trackless.addEvent({
        type: "error",
        name: normalized,
        severity,
        ...(strippedCode ? { code: strippedCode } : {}),
      });
      Trackless.debug(`error — ${normalized} severity=${severity}${code ? ` code=${code}` : ""}`);
      Trackless.checkFlushThreshold();
    } catch {
      // Never throws
    }
  }

  /** Force flush pending events to the ingest endpoint. */
  static async flush(): Promise<void> {
    try {
      await Trackless.performFlush(false);
    } catch {
      // Never throws
    }
  }

  /** Toggle event recording. Disabling discards buffered data. */
  static setEnabled(isEnabled: boolean): void {
    try {
      Trackless.debug(`setEnabled — ${isEnabled}`);
      Trackless.enabled = isEnabled;
      if (!isEnabled) {
        Trackless.buffer.clear();
        Trackless.stopPeriodicFlush();
        Trackless.removeVisibilityListener();
        Trackless.teardownAutoScreenTracking();
      } else if (!Trackless.destroyed && Trackless.configured) {
        Trackless.startPeriodicFlush();
        Trackless.addVisibilityListener();
        if (Trackless.autoScreenTracking) {
          Trackless.setupAutoScreenTracking();
        }
      }
    } catch {
      // Never throws
    }
  }

  /** Flush remaining events and clean up. Permanently disables the instance. */
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
      Trackless.screenViewCooldowns.clear();
      Trackless.funnels.clear();
      Trackless.session.destroy();
      Trackless.configured = false;
    } catch {
      // Never throws
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────

  private static canRecord(): boolean {
    return Trackless.enabled && !Trackless.destroyed && Trackless.configured;
  }

  /** Validate an optional string field (detail, code). Returns true if valid or undefined. */
  private static isValidStringField(value: string | undefined): boolean {
    if (value === undefined) return true;
    if (typeof value !== "string" || value === "") return false;
    if (value.length > EVENT_NAME_MAX_LENGTH) return false;
    return true;
  }

  private static debug(msg: string): void {
    if (Trackless.debugLogging) console.log(`[Trackless] ${msg}`);
  }

  private static warn(msg: string): void {
    if (!Trackless.suppressWarnings) console.warn(`[Trackless] ${msg}`);
  }

  private static addEvent(event: TracklessEvent): void {
    Trackless.buffer.add(event);
  }

  /**
   * Strip PII patterns (emails, SSNs, phone numbers) from a string,
   * replacing matches with [REDACTED].
   */
  private static stripPII(value: string): string {
    // Email addresses
    let result = value.replace(
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi,
      "[REDACTED]",
    );
    // SSN patterns (check before phone numbers to avoid false matches)
    result = result.replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[REDACTED]");
    result = result.replace(/\b\d{9}\b/g, "[REDACTED]");
    // Phone numbers: a digit, then 8+ mixed digit/separator chars, ending with a digit
    result = result.replace(/\+?\d[\d\s\-.()]{8,}\d/g, "[REDACTED]");
    return result;
  }

  /** Matches UUID format: 8-4-4-4-12 hex with hyphens or underscores */
  private static readonly UUID_REGEX =
    /^[0-9a-f]{8}[-_][0-9a-f]{4}[-_][0-9a-f]{4}[-_][0-9a-f]{4}[-_][0-9a-f]{12}$/;
  /** Consecutive hex characters > 24 */
  private static readonly LONG_HEX_REGEX = /[0-9a-f]{25,}/;
  /** Numeric-only strings > 12 characters */
  private static readonly LONG_NUMERIC_REGEX = /^[0-9]{13,}$/;
  /** Entirely hex characters and longer than 16 characters */
  private static readonly ALL_HEX_REGEX = /^[0-9a-f]{17,}$/;

  private static normalizeName(name: string): string | null {
    if (typeof name !== "string") return null;
    const normalized = Trackless.stripPII(name.toLowerCase());
    if (!normalized || normalized.length > EVENT_NAME_MAX_LENGTH) return null;
    if (!EVENT_NAME_REGEX.test(normalized)) {
      Trackless.warn(
        `event name rejected: "${name}" — must match [a-z0-9_.-], no leading/trailing/consecutive dots`,
      );
      Trackless.onError(new Error(`Invalid event name: ${name}`));
      return null;
    }
    // Anti-identifier patterns
    if (
      Trackless.UUID_REGEX.test(normalized) ||
      Trackless.LONG_HEX_REGEX.test(normalized) ||
      Trackless.LONG_NUMERIC_REGEX.test(normalized) ||
      Trackless.ALL_HEX_REGEX.test(normalized)
    ) {
      Trackless.warn(`event name rejected: "${name}" — looks like an identifier`);
      Trackless.onError(new Error(`Invalid event name: ${name}`));
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
    const result = Trackless.session.end();
    if (result) {
      Trackless.funnels.clear();
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

  private static async performFlush(keepalive: boolean): Promise<void> {
    if (Trackless.buffer.isEmpty) return;
    if (!Trackless.circuitBreaker.canAttempt()) {
      Trackless.debug("flush skipped — circuit breaker open");
      return;
    }

    const payloads = Trackless.buffer.drain(Trackless.environment, Trackless.context);
    if (payloads.length === 0) return;

    for (const payload of payloads) {
      Trackless.debug(`flush — ${payload.events.length} events`);
      try {
        const result = await sendPayload(
          Trackless.endpoint,
          Trackless.apiKey,
          payload,
          FLUSH_TIMEOUT_MS,
          keepalive,
        );

        if (result.status >= 500) {
          Trackless.circuitBreaker.recordFailure();
          Trackless.warn(`flush failed — status=${result.status}`);
          Trackless.onError(new Error(`Flush failed with status ${result.status}`));
        } else if (result.status >= 400) {
          // 4xx: discard batch, don't trigger circuit breaker
          Trackless.warn(`flush rejected — status=${result.status}`);
          Trackless.onError(new Error(`Flush rejected with status ${result.status}`));
        } else {
          Trackless.circuitBreaker.recordSuccess();
          Trackless.debug(`flush success — status=${result.status}`);
        }
      } catch (error) {
        Trackless.circuitBreaker.recordFailure();
        Trackless.warn("flush failed — network error");
        Trackless.onError(error instanceof Error ? error : new Error("Flush failed"));
      }
    }
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
        Trackless.endCurrentSession();
        Trackless.performFlush(true).catch(() => {});
      } else if (document.visibilityState === "visible") {
        Trackless.startNewSession();
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

      // Extract hash fragment as detail (e.g., "#pricing" → "pricing")
      const hash =
        typeof window !== "undefined" ? (window.location.hash ?? "").replace(/^#/, "") : "";
      const detail = hash || undefined;

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

  /** Convert a URL path to a screen name */
  private static pathToScreenName(path: string): string {
    let clean = path.replace(/^\//, "");
    if (!clean) return "home";

    clean = clean.replace(/\//g, "_");
    clean = clean.replace(/_+/g, "_");
    clean = clean.replace(/_$/, "");

    return clean;
  }
}
