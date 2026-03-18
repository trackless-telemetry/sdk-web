/**
 * In-memory funnel step deduplication per session.
 *
 * Tracks which step indices have been recorded per funnel name within a session.
 * Prevents the same step from being counted twice in one session.
 * Cleared on session end.
 */
export declare class FunnelTracker {
    /** Map of funnelName -> set of completed step indices */
    private funnels;
    /**
     * Check and record a funnel step for deduplication.
     *
     * @returns true if the step was newly recorded, false if it was a duplicate
     */
    step(funnelName: string, stepIndex: number): boolean;
    /** Clear all funnel state (call on session end). */
    clear(): void;
}
