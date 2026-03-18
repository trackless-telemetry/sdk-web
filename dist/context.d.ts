import type { EventContext } from "./types.js";
/**
 * Detect coarse device context from browser APIs.
 *
 * Privacy invariants enforced:
 * - NEVER sends full user agent string (Invariant 2)
 * - NEVER sends exact screen dimensions (Invariant 2)
 * - NEVER uses IP-based geolocation (Invariant 4)
 * - Region derived from navigator.languages / navigator.language only
 */
export declare function detectContext(appVersion?: string, buildNumber?: string): EventContext;
/**
 * Extract country code from navigator.languages[0] or navigator.language.
 *
 * Returns the country code only (e.g., "US", "FR").
 * NEVER uses IP-based geolocation (Privacy Invariant 4).
 */
declare function detectRegion(): string | undefined;
/** @deprecated Use detectRegion() via detectContext(). Renamed in dimension redesign. */
export declare const detectLocale: typeof detectRegion;
export {};
