import type { EventContext } from "./types.js";

/**
 * Detect coarse device context from browser APIs.
 *
 * Privacy invariants enforced:
 * - NEVER sends full user agent string (Invariant 2)
 * - NEVER sends exact screen dimensions (Invariant 2)
 * - NEVER uses IP-based geolocation (Invariant 4)
 * - Region/locale derived from navigator.languages / navigator.language only
 */
export function detectContext(appVersion?: string, buildNumber?: string): EventContext {
  return {
    platform: "web",
    osVersion: detectOsVersion(),
    deviceClass: detectDeviceClass(),
    locale: detectLocale(),
    appVersion,
    buildNumber,
    // daysSinceInstall omitted — web has no install concept
  };
}

/** Extract major.minor OS version */
function detectOsVersion(): string | undefined {
  try {
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    if (!ua) return undefined;

    // Windows: "Windows NT 10.0" → "10.0"
    const windowsMatch = ua.match(/Windows NT (\d+\.\d+)/);
    if (windowsMatch) return windowsMatch[1];

    // macOS: "Mac OS X 10_15_7" → "10.15", "Mac OS X 14_0" → "14.0"
    const macMatch = ua.match(/Mac OS X (\d+)[_.](\d+)/);
    if (macMatch) return `${macMatch[1]}.${macMatch[2]}`;

    // iOS: "CPU iPhone OS 17_0" or "CPU OS 17_0" → "17.0"
    const iosMatch = ua.match(/(?:iPhone|CPU) OS (\d+)[_.](\d+)/);
    if (iosMatch) return `${iosMatch[1]}.${iosMatch[2]}`;

    // Android: "Android 14.0" or "Android 14" → "14.0" or "14"
    const androidMatch = ua.match(/Android (\d+(?:\.\d+)?)/);
    if (androidMatch) {
      const v = androidMatch[1];
      return v.includes(".") ? v : `${v}.0`;
    }

    // Chrome OS: "CrOS x86_64 14541.0.0" → "14541.0"
    const crosMatch = ua.match(/CrOS \S+ (\d+\.\d+)/);
    if (crosMatch) return crosMatch[1];

    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Detect device class from viewport width and touch capability.
 *
 * Phone: touch-capable AND viewport width < 768px
 * Tablet: touch-capable AND viewport width 768-1024px
 * Desktop: everything else
 */
function detectDeviceClass(): "phone" | "tablet" | "desktop" | undefined {
  try {
    if (typeof navigator === "undefined" || typeof window === "undefined") {
      return undefined;
    }

    const hasTouch = navigator.maxTouchPoints > 0;
    const width = window.innerWidth;

    if (hasTouch && width < 768) return "phone";
    if (hasTouch && width < 1024) return "tablet";
    return "desktop";
  } catch {
    return undefined;
  }
}

/**
 * Extract locale from navigator.languages[0] or navigator.language.
 *
 * Returns the full locale tag (e.g., "en-US", "fr-FR").
 * NEVER uses IP-based geolocation (Privacy Invariant 4).
 */
function detectLocale(): string | undefined {
  try {
    if (typeof navigator === "undefined") return undefined;

    const lang =
      (navigator.languages && navigator.languages.length > 0
        ? navigator.languages[0]
        : undefined) ?? navigator.language;

    return lang || undefined;
  } catch {
    return undefined;
  }
}
