import type { EventContext } from "./types.js";
import pkg from "../package.json" with { type: "json" };

// navigator.userAgentData and navigator.webdriver are non-standard members
// not in lib.dom.d.ts. Narrow interfaces keep feature-detection strongly typed.
interface NavigatorUABrand {
  brand: string;
  version: string;
}
interface NavigatorUAData {
  brands?: NavigatorUABrand[];
  platform?: string;
  platformVersion?: string;
}
interface NavigatorExt {
  userAgentData?: NavigatorUAData;
  webdriver?: boolean;
}

function navExt(): NavigatorExt {
  return typeof navigator !== "undefined" ? (navigator as Navigator & NavigatorExt) : {};
}

/**
 * Detect coarse device context from browser APIs.
 *
 * Privacy invariants enforced:
 * - NEVER sends full user agent string (Invariant 2)
 * - NEVER sends exact screen dimensions (Invariant 2)
 * - NEVER uses IP-based geolocation (Invariant 4)
 * - Region derived from navigator.languages / navigator.language only
 */
export function detectContext(appVersion?: string, buildNumber?: string): EventContext {
  return {
    platform: "web",
    osVersion: detectOsVersion(),
    deviceClass: detectDeviceClass(),
    region: detectRegion(),
    language: detectLanguage(),
    browser: detectBrowser(),
    os: detectOs(),
    appVersion,
    buildNumber,
    sdkVersion: `web/${pkg.version}`,
    distributionChannel: typeof window !== "undefined" ? window.location.hostname : undefined,
    // daysSinceInstall omitted — web has no install concept
  };
}

/** Extract major OS version only */
function detectOsVersion(): string | undefined {
  try {
    // Prefer userAgentData.platformVersion when available (Chromium browsers).
    // This returns the real OS version, unlike the UA string which Apple froze
    // at "Mac OS X 10_15_7" for macOS and "Windows NT 10.0" for Windows 11.
    const uaData = navExt().userAgentData;
    if (uaData?.platformVersion) {
      const major = uaData.platformVersion.split(".")[0];
      if (major) return major;
    }

    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    if (!ua) return undefined;

    let version: string | undefined;

    // Windows: "Windows NT 10.0" → "10"
    const windowsMatch = ua.match(/Windows NT (\d+\.\d+)/);
    if (windowsMatch) version = windowsMatch[1];

    // iOS must be checked before macOS — iPhone/iPad UA strings contain
    // "like Mac OS X" but the real version is in "CPU iPhone OS 18_0"
    if (!version) {
      const iosMatch = ua.match(/(?:iPhone|CPU) OS (\d+)[_.](\d+)/);
      if (iosMatch) version = `${iosMatch[1]}.${iosMatch[2]}`;
    }

    // macOS: skip UA-based version — Apple froze it at "Mac OS X 10_15_7" in
    // Safari regardless of actual macOS version. Returning "10" is misleading.
    // The real version is only available via userAgentData (Chromium) above.

    // Android: "Android 14.0" or "Android 14" → "14"
    if (!version) {
      const androidMatch = ua.match(/Android (\d+(?:\.\d+)?)/);
      if (androidMatch) {
        const v = androidMatch[1];
        version = v.includes(".") ? v : `${v}.0`;
      }
    }

    // Chrome OS: "CrOS x86_64 14541.0.0" → "14541"
    if (!version) {
      const crosMatch = ua.match(/CrOS \S+ (\d+\.\d+)/);
      if (crosMatch) version = crosMatch[1];
    }

    const major = version?.split(".")[0];
    return major || undefined;
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
 * Extract country code from navigator.languages[0] or navigator.language.
 *
 * Returns the country code only (e.g., "US", "FR").
 * NEVER uses IP-based geolocation (Privacy Invariant 4).
 */
function detectRegion(): string | undefined {
  try {
    const lang = navigator.languages?.[0] ?? navigator.language;
    if (lang) {
      const parts = lang.split("-");
      if (parts[1]) return parts[1].toUpperCase();
    }
    const resolved = new Intl.DateTimeFormat().resolvedOptions().locale;
    const parts = resolved.split("-");
    return parts[1]?.toUpperCase();
  } catch {
    return undefined;
  }
}

/**
 * Extract language code from navigator.languages[0] or navigator.language.
 *
 * Returns the ISO 639-1 language code only (e.g., "en", "fr", "de").
 * Derived from browser locale settings — no network calls.
 */
function detectLanguage(): string | undefined {
  try {
    const lang = navigator.languages?.[0] ?? navigator.language;
    if (lang) {
      const code = lang.split("-")[0].toLowerCase();
      if (code) return code;
    }
    const resolved = new Intl.DateTimeFormat().resolvedOptions().locale;
    const code = resolved.split("-")[0].toLowerCase();
    return code || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Detect browser from navigator.userAgentData (Chrome, Edge, Firefox)
 * with Safari fallback via navigator.vendor.
 */
function detectBrowser(): "chrome" | "safari" | "firefox" | "edge" | "bot" | "other" {
  try {
    // Detect automation-driven browsers via the standard W3C WebDriver flag.
    // This surfaces obvious bot traffic (Selenium, Puppeteer, Playwright) without
    // parsing the full user agent string (Privacy Invariant 2).
    const nav = navExt();
    if (nav.webdriver) return "bot";

    const uaData = nav.userAgentData;
    if (uaData?.brands) {
      const brands = uaData.brands.map((b) => b.brand.toLowerCase());
      if (brands.some((b) => b.includes("edge") || b.includes("edg"))) return "edge";
      if (brands.some((b) => b.includes("firefox"))) return "firefox";
      if (brands.some((b) => b.includes("chrome") || b.includes("chromium"))) return "chrome";
    }
    // Safari fallback — Safari does not support userAgentData
    if (navigator.vendor === "Apple Computer, Inc.") return "safari";
    return "other";
  } catch {
    return "other";
  }
}

/**
 * Detect OS from navigator.userAgentData with UA string fallback.
 */
function detectOs(): "macos" | "windows" | "linux" | "android" | "ios" | "other" {
  try {
    const uaData = navExt().userAgentData;
    if (uaData?.platform) {
      const p = uaData.platform.toLowerCase();
      if (p === "macos" || p === "mac os x") return "macos";
      if (p === "windows") return "windows";
      if (p === "linux" || p.includes("cros")) return "linux";
      if (p === "android") return "android";
      if (p === "ios") return "ios";
      return "other";
    }
    // UA fallback for Safari
    // iPhone/iPad/iPod must be checked before Mac OS X because iOS UA strings
    // contain "like Mac OS X" (e.g., "CPU iPhone OS 18_0 like Mac OS X")
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/.test(ua)) return "ios";
    if (/Mac OS X/.test(ua)) return "macos";
    if (/Windows/.test(ua)) return "windows";
    if (/Android/.test(ua)) return "android";
    if (/Linux|CrOS/.test(ua)) return "linux";
    return "other";
  } catch {
    return "other";
  }
}

/** @deprecated Use detectRegion() via detectContext(). Renamed in dimension redesign. */
export const detectLocale = detectRegion;
