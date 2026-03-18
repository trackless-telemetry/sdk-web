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
const DEFAULT_FLUSH_INTERVAL_MS = 60_000;

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
 * Trackless.screen('Home');
 * Trackless.feature('export_clicked');
 * ```
 */
export class Trackless {
  private static apiKey: string = "";
  private static endpoint: string = "";
  private static environment: Environment = "production";
  private static onError: (error: Error) => void = () => {};
  private static flushIntervalMs: number = DEFAULT_FLUSH_INTERVAL_MS;
  private static autoScreenTracking: boolean = false;
  private static debugLogging: boolean = false;

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
  private static originalPushState: typeof history.pushState | null = null;

  /** Per-route screen view deduplication: name -> last recorded timestamp */
  private static screenViewCooldowns: Map<string, number> = new Map();

  /** Configure the SDK and start a new session. */
  static configure(config: TracklessConfig): void {
    try {
      Trackless.apiKey = config.apiKey;
      Trackless.endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
      Trackless.environment = config.environment ?? "production";
      Trackless.enabled = config.enabled ?? true;
      Trackless.onError = config.onError ?? (() => {});
      Trackless.flushIntervalMs = config.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
      Trackless.autoScreenTracking = config.autoScreenTracking ?? false;
      Trackless.debugLogging = config.debugLogging ?? false;

      Trackless.buffer = new EventBuffer();
      Trackless.circuitBreaker = new CircuitBreaker();
      Trackless.context = detectContext(config.appVersion, config.buildNumber);
      Trackless.session = new SessionManager();
      Trackless.funnels = new FunnelTracker();
      Trackless.screenViewCooldowns = new Map();
      Trackless.destroyed = false;
      Trackless.configured = true;

      Trackless.debug(
        `configured — env=${Trackless.environment} endpoint=${Trackless.endpoint} flush=${Trackless.flushIntervalMs}ms`,
      );

      if (Trackless.enabled) {
        // Start session
        Trackless.startNewSession();

        Trackless.startPeriodicFlush();
        Trackless.addVisibilityListener();
        if (Trackless.autoScreenTracking) {
          Trackless.setupAutoScreenTracking();
        }

        // Handle session inactivity timeout
        Trackless.session.onTimeout = () => {
          Trackless.endCurrentSession();
          Trackless.startNewSession();
        };
      }
    } catch {
      Trackless.enabled = false;
    }
  }

  /** Record a screen view. */
  static screen(name: string): void {
    try {
      if (!Trackless.canRecord()) return;
      const normalized = Trackless.normalizeName(name);
      if (!normalized) return;

      Trackless.session.recordActivity();
      Trackless.addEvent({ type: "screen", name: normalized });
      Trackless.debug(`screen — ${normalized}`);
      Trackless.checkFlushThreshold();
    } catch {
      // Never throws
    }
  }

  /** Record a feature usage event. */
  static feature(name: string): void {
    try {
      if (!Trackless.canRecord()) return;
      const normalized = Trackless.normalizeName(name);
      if (!normalized) return;

      Trackless.session.recordActivity();
      Trackless.addEvent({ type: "feature", name: normalized });
      Trackless.debug(`feature — ${normalized}`);
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

  /** Record a selection event (e.g., theme preference, language choice). */
  static selection(name: string, option: string): void {
    try {
      if (!Trackless.canRecord()) return;
      const normalized = Trackless.normalizeName(name);
      if (!normalized || !option) return;

      Trackless.session.recordActivity();
      Trackless.addEvent({ type: "selection", name: normalized, option });
      Trackless.debug(`selection — ${normalized} option=${option}`);
      Trackless.checkFlushThreshold();
    } catch {
      // Never throws
    }
  }

  /** Record a performance measurement. */
  static performance(name: string, duration: number): void {
    try {
      if (!Trackless.canRecord()) return;
      const normalized = Trackless.normalizeName(name);
      if (!normalized) return;
      if (typeof duration !== "number" || duration < 0) return;

      Trackless.session.recordActivity();
      Trackless.addEvent({ type: "performance", name: normalized, duration });
      Trackless.debug(`performance — ${normalized} duration=${duration}ms`);
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

      Trackless.session.recordActivity();
      Trackless.addEvent({
        type: "error",
        name: normalized,
        severity,
        ...(code ? { code } : {}),
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
  static setEnabled(enabled: boolean): void {
    try {
      Trackless.debug(`setEnabled — ${enabled}`);
      Trackless.enabled = enabled;
      if (!enabled) {
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

  private static debug(msg: string): void {
    if (Trackless.debugLogging) console.log(`[Trackless] ${msg}`);
  }

  private static debugWarn(msg: string): void {
    if (Trackless.debugLogging) console.warn(`[Trackless] ${msg}`);
  }

  private static addEvent(event: TracklessEvent): void {
    Trackless.buffer.add(event);
  }

  private static normalizeName(name: string): string | null {
    if (typeof name !== "string") return null;
    const normalized = name.toLowerCase();
    if (!normalized || normalized.length > EVENT_NAME_MAX_LENGTH) return null;
    if (!EVENT_NAME_REGEX.test(normalized)) {
      Trackless.debugWarn(`invalid event name rejected: "${name}"`);
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
          Trackless.debugWarn(`flush failed — status=${result.status}`);
          Trackless.onError(new Error(`Flush failed with status ${result.status}`));
        } else if (result.status >= 400) {
          // 4xx: discard batch, don't trigger circuit breaker
          Trackless.debugWarn(`flush rejected — status=${result.status}`);
          Trackless.onError(new Error(`Flush rejected with status ${result.status}`));
        } else {
          Trackless.circuitBreaker.recordSuccess();
          Trackless.debug(`flush success — status=${result.status}`);
        }
      } catch (error) {
        Trackless.circuitBreaker.recordFailure();
        Trackless.debugWarn("flush failed — network error");
        Trackless.onError(error instanceof Error ? error : new Error("Flush failed"));
      }
    }
  }

  private static startPeriodicFlush(): void {
    if (Trackless.flushTimer !== null) return;
    Trackless.flushTimer = setInterval(() => {
      Trackless.performFlush(false).catch(() => {});
    }, Trackless.flushIntervalMs);
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
  }

  private static recordScreenView(): void {
    try {
      if (!Trackless.canRecord()) return;

      const path = typeof window !== "undefined" ? window.location.pathname : "/";
      const screenName = Trackless.pathToScreenName(path);

      if (!EVENT_NAME_REGEX.test(screenName)) return;

      // Per-route deduplication
      const now = Date.now();
      const lastRecorded = Trackless.screenViewCooldowns.get(screenName);
      if (lastRecorded !== undefined && now - lastRecorded < SCREEN_VIEW_COOLDOWN_MS) {
        return;
      }

      Trackless.screenViewCooldowns.set(screenName, now);
      Trackless.screen(screenName);
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
