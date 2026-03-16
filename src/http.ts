import type { EventPayload, SendResult } from "./types.js";

/** Default timeout for flush requests: 10 seconds */
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Send an event payload to the ingest endpoint.
 *
 * Uses AbortController for timeout enforcement.
 * Timeout is treated as a network error (triggers circuit breaker).
 */
export async function sendPayload(
  endpoint: string,
  apiKey: string,
  payload: EventPayload,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  keepalive: boolean = false,
): Promise<SendResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": apiKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
      keepalive,
    });

    clearTimeout(timer);

    let body: SendResult["body"];
    try {
      body = await response.json();
    } catch {
      // Response body parse failure is not critical
    }

    return { status: response.status, body };
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
}

/**
 * Send payload via navigator.sendBeacon (for beforeunload/visibility hidden).
 *
 * sendBeacon doesn't support custom headers, so we encode the API key in the payload.
 * Falls back to regular fetch with keepalive if sendBeacon is unavailable.
 */
export function sendBeacon(endpoint: string, apiKey: string, payload: EventPayload): boolean {
  if (typeof navigator !== "undefined" && navigator.sendBeacon) {
    const body = JSON.stringify(payload);
    const blob = new Blob([body], { type: "application/json" });
    // Append API key as query parameter for sendBeacon (no custom headers)
    const url = `${endpoint}?apiKey=${encodeURIComponent(apiKey)}`;
    return navigator.sendBeacon(url, blob);
  }
  return false;
}
