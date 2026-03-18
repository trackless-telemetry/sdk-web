import type { EventPayload, SendResult } from "./types.js";
/**
 * Send an event payload to the ingest endpoint.
 *
 * Uses AbortController for timeout enforcement.
 * Timeout is treated as a network error (triggers circuit breaker).
 */
export declare function sendPayload(endpoint: string, apiKey: string, payload: EventPayload, timeoutMs?: number, keepalive?: boolean): Promise<SendResult>;
/**
 * Send payload via navigator.sendBeacon (for beforeunload/visibility hidden).
 *
 * sendBeacon doesn't support custom headers, so we encode the API key in the payload.
 * Falls back to regular fetch with keepalive if sendBeacon is unavailable.
 */
export declare function sendBeacon(endpoint: string, apiKey: string, payload: EventPayload): boolean;
