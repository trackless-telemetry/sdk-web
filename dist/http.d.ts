import type { EventPayload, SendResult } from "./types.js";
/**
 * Send an event payload to the ingest endpoint.
 *
 * Uses AbortController for timeout enforcement.
 * Timeout is treated as a network error (triggers circuit breaker).
 */
export declare function sendPayload(endpoint: string, apiKey: string, payload: EventPayload, timeoutMs?: number, keepalive?: boolean): Promise<SendResult>;
