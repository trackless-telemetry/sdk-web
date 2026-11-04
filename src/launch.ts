/**
 * The launch-time measurement behind `measureLaunch`, once per page load, in
 * memory only.
 *
 * **Definition.** The page's `PerformanceNavigationTiming` entry, from
 * navigation start (the entry's `startTime`, the page's time origin) to the
 * moment the `load` event fired (`loadEventStart`). A soft navigation inside a
 * single-page app is not a navigation entry, so it is never a launch. When
 * `load` has already fired at `configure()`, the entry is read at once;
 * otherwise it is read when `load` fires. Where the entry does not exist,
 * nothing is measured.
 *
 * **Skipped launches.** A page that did not load in front of the user sends
 * nothing, and the probe finishes for the page:
 * - a prerendered page (`document.prerendering` at `configure()`, or a
 *   navigation entry with an `activationStart` after zero);
 * - a page hidden at any time before `load`. Where the browser records
 *   `visibility-state` performance entries (Chromium), that is any `hidden`
 *   entry at or before `loadEventStart`. Elsewhere it is a page hidden at
 *   `configure()`, or one that goes hidden between `configure()` and `load`.
 *   A `configure()` after `load` in such a browser cannot see an earlier
 *   hidden period, so that launch is still sent;
 * - a launch longer than {@link MAX_LAUNCH_SECONDS}, or one that is negative
 *   or not a finite number. It is dropped, not clipped.
 *
 * Reads nothing about earlier page loads and stores nothing.
 */

/** A launch longer than this many seconds is dropped, not clipped. */
export const MAX_LAUNCH_SECONDS = 60;

interface NavigationEntry {
  startTime: number;
  loadEventStart: number;
  activationStart?: number;
}

interface VisibilityStateEntry {
  name: string;
  startTime: number;
}

/** This page's navigation entry, or null where the browser has none. */
function navigationEntry(): NavigationEntry | null {
  if (typeof performance === "undefined" || typeof performance.getEntriesByType !== "function") {
    return null;
  }
  const entry = performance.getEntriesByType("navigation")[0] as unknown as
    | NavigationEntry
    | undefined;
  return entry && typeof entry.loadEventStart === "number" ? entry : null;
}

/** Whether the page is being prerendered right now. */
function isPrerendering(): boolean {
  return (
    typeof document !== "undefined" &&
    (document as Document & { prerendering?: boolean }).prerendering === true
  );
}

/** Whether the page is hidden right now. */
function isHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

/** Whether this browser records `visibility-state` performance entries (Chromium). */
function visibilityEntriesSupported(): boolean {
  try {
    const types =
      typeof PerformanceObserver !== "undefined"
        ? (PerformanceObserver.supportedEntryTypes as readonly string[] | undefined)
        : undefined;
    return Array.isArray(types) && types.includes("visibility-state");
  } catch {
    return false;
  }
}

/** Whether a `visibility-state` entry shows the page hidden at or before `loadEventStart`. */
function hiddenEntryBefore(loadEventStart: number): boolean {
  try {
    const entries = performance.getEntriesByType(
      "visibility-state",
    ) as unknown as VisibilityStateEntry[];
    return entries.some((e) => e.name === "hidden" && e.startTime <= loadEventStart);
  } catch {
    return false;
  }
}

/** Seconds from navigation start to `load`, or null when `load` has not fired or there is no entry. */
export function readLaunchSeconds(): number | null {
  const entry = navigationEntry();
  if (!entry || !(entry.loadEventStart > 0)) return null;
  return (entry.loadEventStart - entry.startTime) / 1000;
}

/** Whether `seconds` is a launch to send: finite, not negative, and at most the cap. */
function isSendable(seconds: number): boolean {
  return Number.isFinite(seconds) && seconds >= 0 && seconds <= MAX_LAUNCH_SECONDS;
}

/**
 * Measures the page's launch once. `arm()` takes effect the first time only:
 * a later `configure()` does not measure again.
 */
export class LaunchProbe {
  private armed = false;
  private loadHandler: (() => void) | null = null;
  private visibilityHandler: (() => void) | null = null;

  /**
   * Measure the launch and hand it to `onMeasured`, now when `load` has
   * already fired, or when it fires. Does nothing after the first call,
   * where there is no navigation entry, or for a launch the rules above skip.
   */
  arm(onMeasured: (seconds: number) => void): void {
    if (this.armed) return;
    this.armed = true;

    if (isPrerendering()) return;
    const useEntries = visibilityEntriesSupported();
    // Without visibility-state entries, a page hidden now may have been
    // hidden before `load`; with them, the entries decide.
    if (!useEntries && isHidden()) return;

    const finish = (): void => {
      const entry = navigationEntry();
      if (!entry || !(entry.loadEventStart > 0)) return;
      if (typeof entry.activationStart === "number" && entry.activationStart > 0) return;
      if (useEntries && hiddenEntryBefore(entry.loadEventStart)) return;
      const seconds = (entry.loadEventStart - entry.startTime) / 1000;
      if (isSendable(seconds)) onMeasured(seconds);
    };

    if (readLaunchSeconds() !== null) {
      finish();
      return;
    }
    if (typeof window === "undefined" || !navigationEntry()) return;

    if (!useEntries && typeof document !== "undefined") {
      this.visibilityHandler = () => {
        if (!isHidden()) return;
        // Hidden before `load`: this page load sends no launch.
        this.stopListening();
      };
      document.addEventListener("visibilitychange", this.visibilityHandler);
    }

    this.loadHandler = () => {
      this.stopListening();
      if (readLaunchSeconds() !== null) {
        finish();
        return;
      }
      // `loadEventStart` is stamped as the event is dispatched; read again
      // after the handlers if this browser stamps it later.
      setTimeout(finish, 0);
    };
    window.addEventListener("load", this.loadHandler, { once: true });
  }

  /** Remove the `load` and `visibilitychange` listeners, if any. */
  private stopListening(): void {
    if (this.loadHandler && typeof window !== "undefined") {
      window.removeEventListener("load", this.loadHandler);
    }
    if (this.visibilityHandler && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
    }
    this.loadHandler = null;
    this.visibilityHandler = null;
  }

  /** Whether `arm()` has run. */
  get isArmed(): boolean {
    return this.armed;
  }

  /** Whether a `load` listener is waiting. */
  get isWaiting(): boolean {
    return this.loadHandler !== null;
  }
}
