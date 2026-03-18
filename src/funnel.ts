/**
 * In-memory funnel step deduplication per session.
 *
 * Tracks which step indices have been recorded per funnel name within a session.
 * Prevents the same step from being counted twice in one session.
 * Cleared on session end.
 */
export class FunnelTracker {
  /** Map of funnelName -> set of completed step indices */
  private funnels: Map<string, Set<number>> = new Map();

  /**
   * Check and record a funnel step for deduplication.
   *
   * @returns true if the step was newly recorded, false if it was a duplicate
   */
  step(funnelName: string, stepIndex: number): boolean {
    let steps = this.funnels.get(funnelName);
    if (!steps) {
      steps = new Set();
      this.funnels.set(funnelName, steps);
    }

    // Dedup — if this step index was already recorded, skip
    if (steps.has(stepIndex)) return false;

    steps.add(stepIndex);
    return true;
  }

  /** Clear all funnel state (call on session end). */
  clear(): void {
    this.funnels.clear();
  }
}
