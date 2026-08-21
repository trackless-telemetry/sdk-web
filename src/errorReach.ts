/**
 * In-memory per-session first-occurrence tracker for error reach.
 *
 * Records which normalized error names have occurred at least once in the
 * current session so the SDK can mark the FIRST occurrence of each error with
 * `firstOccurrences: 1`. This powers session-reach analytics (the share of
 * sessions that hit an error at least once) without any cross-session linking.
 *
 * Dedup is by normalized error NAME only, not `(name, severity, code)` — a
 * session that reports one error at several severities or with several codes
 * still contributes a single first occurrence.
 *
 * Zero persistence — all state is in-memory only. Cleared on session end
 * (mirrors {@link FeatureReachTracker}); it deliberately SURVIVES buffer
 * flushes so an error seen once but flushed mid-session is not re-marked as a
 * first occurrence.
 */
export class ErrorReachTracker {
  /** Set of normalized error names already seen this session */
  private seen: Set<string> = new Set();

  /**
   * Check and record the first occurrence of an error name this session.
   *
   * @returns true if this is the first occurrence of the name this session, false otherwise
   */
  firstOccurrence(name: string): boolean {
    if (this.seen.has(name)) return false;
    this.seen.add(name);
    return true;
  }

  /** Clear all first-occurrence state (call on session end). */
  clear(): void {
    this.seen.clear();
  }
}
