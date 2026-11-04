/**
 * The hang detection behind `detectHangs`: a `PerformanceObserver` on
 * `longtask` entries.
 *
 * Each long task of `HANG_THRESHOLD_MS` (250 ms) or more is one hang sample,
 * its duration in seconds; the browser reports it after the task has
 * finished, so the sample arrives once the main thread is free again. Shorter
 * long tasks (the API reports from 50 ms) are ignored. `buffered: false`:
 * tasks from before the observer started, or from while the page was hidden,
 * are never read.
 *
 * The `longtask` entry type exists only in Chromium-based browsers. Elsewhere
 * `start()` does nothing, silently — Safari and Firefox send no hang data.
 *
 * Runs only while the page is visible: `Trackless` starts it when the page is
 * visible and stops it when it is hidden. Nothing here throws.
 */

/** A main-thread task at or above this is a hang. */
export const HANG_THRESHOLD_MS = 250;

/** Whether this browser reports `longtask` entries. */
export function longTasksSupported(): boolean {
  try {
    return (
      typeof PerformanceObserver !== "undefined" &&
      Array.isArray(PerformanceObserver.supportedEntryTypes) &&
      PerformanceObserver.supportedEntryTypes.includes("longtask")
    );
  } catch {
    return false;
  }
}

export class HangObserver {
  private observer: PerformanceObserver | null = null;

  /** Start observing, when supported and not already running. */
  start(onHang: (seconds: number) => void): void {
    if (this.observer || !longTasksSupported()) return;
    try {
      const observer = new PerformanceObserver((list) => {
        try {
          for (const entry of list.getEntries()) {
            if (entry.duration >= HANG_THRESHOLD_MS) onHang(entry.duration / 1000);
          }
        } catch {
          // Never throws into the page
        }
      });
      observer.observe({ type: "longtask", buffered: false });
      this.observer = observer;
    } catch {
      this.observer = null;
    }
  }

  /** Stop observing. */
  stop(): void {
    if (!this.observer) return;
    try {
      this.observer.disconnect();
    } catch {
      // Never throws
    }
    this.observer = null;
  }

  /** Whether the observer is running. */
  get isRunning(): boolean {
    return this.observer !== null;
  }
}
