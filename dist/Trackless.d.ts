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
/** Error severity constants for use with `Trackless.error()`. */
export declare const Severity: {
    readonly DEBUG: "debug";
    readonly INFO: "info";
    readonly WARNING: "warning";
    readonly ERROR: "error";
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
    private static funnels;
    /** Per-session first-use set backing feature-reach `firstUses` marking. Reset on session end. */
    private static featureReach;
    /** Per-session first-occurrence set backing error-reach `firstOccurrences` marking. Reset on session end. */
    private static errorReach;
    private static flushTimer;
    private static visibilityHandler;
    private static popstateHandler;
    private static hashchangeHandler;
    private static originalPushState;
    /** Per-route screen view deduplication: "name" or "name|detail" -> last recorded timestamp */
    private static screenViewCooldowns;
    /** Whether the SDK has been configured and is ready to record events. */
    static get isConfigured(): boolean;
    /** Configure the SDK and start a new session. */
    static configure(config: TracklessConfig): void;
    /** Record a view event. */
    static view(name: string, detail?: string): void;
    /** Record a feature usage event. */
    static feature(name: string, detail?: string): void;
    /** Record a funnel step. */
    static funnel(funnelName: string, stepIndex: number, stepName: string): void;
    /** Record a performance measurement. */
    static performance(name: string, durationSeconds: number, thresholdSeconds?: number): void;
    /** Record an error event. */
    static error(name: string, severity?: ErrorSeverity, code?: string): void;
    /** Force flush pending events to the ingest endpoint. */
    static flush(): Promise<void>;
    /** Toggle event recording. Disabling discards buffered data. */
    static setEnabled(isEnabled: boolean): void;
    /** Flush remaining events and clean up. Permanently disables the instance. */
    static destroy(): Promise<void>;
    private static canRecord;
    /**
     * Normalize an event field (name, detail, step, code) into a valid format.
     * Strips PII, lowercases, replaces invalid chars with underscores, and validates.
     * Returns null if the result is empty or matches an abuse pattern.
     */
    private static normalizeField;
    private static debug;
    private static warn;
    private static addEvent;
    /**
     * Strip PII patterns (emails, SSNs, phone numbers) from a string,
     * replacing matches with [REDACTED].
     */
    private static stripPII;
    /** Matches UUID format: 8-4-4-4-12 hex with hyphens or underscores */
    private static readonly UUID_REGEX;
    /** Consecutive hex characters > 24 */
    private static readonly LONG_HEX_REGEX;
    /** Numeric-only strings > 12 characters */
    private static readonly LONG_NUMERIC_REGEX;
    /** Entirely hex characters and longer than 16 characters */
    private static readonly ALL_HEX_REGEX;
    /** UUID in a URL path segment (8-4-4-4-12 hex with hyphens) */
    private static readonly EMBEDDED_UUID_RE;
    /** 6+ digit numeric ID in a URL path segment */
    private static readonly LONG_NUMERIC_RE;
    /** 12+ hex chars in a URL path segment (MongoDB ObjectIDs, short hashes) */
    private static readonly LONG_HEX_RE;
    private static normalizeName;
    private static startNewSession;
    private static endCurrentSession;
    private static checkFlushThreshold;
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
    /** Replace dynamic URL segments (UUIDs, long numeric IDs, long hex strings) with `-id-` */
    private static stripDynamicSegments;
    /** Convert a URL path to a screen name */
    private static pathToScreenName;
}
