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
export declare const MAX_LAUNCH_SECONDS = 60;
/** Seconds from navigation start to `load`, or null when `load` has not fired or there is no entry. */
export declare function readLaunchSeconds(): number | null;
/**
 * Measures the page's launch once. `arm()` takes effect the first time only:
 * a later `configure()` does not measure again.
 */
export declare class LaunchProbe {
    private armed;
    private loadHandler;
    private visibilityHandler;
    /**
     * Measure the launch and hand it to `onMeasured`, now when `load` has
     * already fired, or when it fires. Does nothing after the first call,
     * where there is no navigation entry, or for a launch the rules above skip.
     */
    arm(onMeasured: (seconds: number) => void): void;
    /** Remove the `load` and `visibilitychange` listeners, if any. */
    private stopListening;
    /** Whether `arm()` has run. */
    get isArmed(): boolean;
    /** Whether a `load` listener is waiting. */
    get isWaiting(): boolean;
}
