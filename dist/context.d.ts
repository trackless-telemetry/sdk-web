import type { Environment, EventContext } from "./types.js";
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
 * Whether a page hostname names this machine: a loopback or reserved-local
 * host, where a page is almost certainly a developer's local build.
 *
 * Counts: `localhost`, any `*.localhost` (RFC 6761), IPv4 127.0.0.0/8,
 * IPv6 loopback (`[::1]` as `location.hostname` reports it, or bare `::1`),
 * and `0.0.0.0`. Deliberately does NOT count LAN or private IPs, `.local`,
 * `.test`, an empty hostname (`file:` pages — Electron production builds load
 * from `file://`), or anything else: those default to production, and the
 * integrator sets `environment` explicitly if they want sandbox.
 *
 * Case-insensitive. Pure, and exported for tests only (not part of the
 * public entry). The hostname is compared in memory and never sent or stored.
 */
export declare function isLocalDevHost(hostname: unknown): boolean;
/**
 * The environment to use when the integrator did not configure one: `sandbox`
 * on a local-development host (see `isLocalDevHost`), `production` everywhere
 * else, including outside a browser. An explicit `environment` always wins and
 * never reaches this function.
 */
export declare function defaultEnvironment(): Environment;
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
