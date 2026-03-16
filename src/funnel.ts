/**
 * In-memory funnel step tracking per session.
 *
 * Tracks which steps have been completed per funnel name within a session.
 * Provides deduplication and automatic stepIndex assignment.
 * Cleared on session end.
 */
export class FunnelTracker {
  /** Map of funnelName -> list of completed step names (in order) */
  private funnels: Map<string, string[]> = new Map();

  /**
   * Record a funnel step.
   *
   * @returns stepIndex if the step was recorded, or null if it was a duplicate
   */
  step(funnelName: string, stepName: string): number | null {
    let steps = this.funnels.get(funnelName);
    if (!steps) {
      steps = [];
      this.funnels.set(funnelName, steps);
    }

    // Dedup — if this step was already completed, skip
    if (steps.includes(stepName)) return null;

    const stepIndex = steps.length;
    steps.push(stepName);
    return stepIndex;
  }

  /** Clear all funnel state (call on session end). */
  clear(): void {
    this.funnels.clear();
  }
}
