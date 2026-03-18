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
 * Trackless.feature('export_clicked');
 * ```
 */
export declare class Trackless {
    private static apiKey;
    private static endpoint;
    private static environment;
    private static onError;
    private static flushIntervalMs;
    private static autoScreenTracking;
    private static debugLogging;
    private static enabled;
    private static destroyed;
    private static configured;
    private static buffer;
    private static circuitBreaker;
    private static context;
    private static session;
    private static funnels;
    private static flushTimer;
    private static visibilityHandler;
    private static popstateHandler;
    private static originalPushState;
    /** Per-route screen view deduplication: name -> last recorded timestamp */
    private static screenViewCooldowns;
    /** Configure the SDK and start a new session. */
    static configure(config: TracklessConfig): void;
    /** Record a view event. */
    static view(name: string, detail?: string): void;
    /** Record a feature usage event. */
    static feature(name: string, detail?: string): void;
    /** Record a funnel step. */
    static funnel(funnelName: string, stepIndex: number, stepName: string): void;
    /** Record a performance measurement. */
    static performance(name: string, duration: number): void;
    /** Record an error event. */
    static error(name: string, severity?: ErrorSeverity, code?: string): void;
    /** Force flush pending events to the ingest endpoint. */
    static flush(): Promise<void>;
    /** Toggle event recording. Disabling discards buffered data. */
    static setEnabled(enabled: boolean): void;
    /** Flush remaining events and clean up. Permanently disables the instance. */
    static destroy(): Promise<void>;
    private static canRecord;
    private static debug;
    private static debugWarn;
    private static addEvent;
    private static normalizeName;
    private static startNewSession;
    private static endCurrentSession;
    private static checkFlushThreshold;
    private static performFlush;
    private static startPeriodicFlush;
    private static stopPeriodicFlush;
    private static addVisibilityListener;
    private static removeVisibilityListener;
    private static setupAutoScreenTracking;
    private static teardownAutoScreenTracking;
    private static recordScreenView;
    /** Convert a URL path to a screen name */
    private static pathToScreenName;
}
