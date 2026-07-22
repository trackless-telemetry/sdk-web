/**
 * In-memory per-session first-use tracker for feature reach.
 *
 * Records which normalized feature names have been used at least once in the
 * current session so the SDK can mark the FIRST use of each feature with
 * `firstUses: 1`. This powers session-reach analytics (the share of sessions
 * that use a feature at least once) without any cross-session linking.
 *
 * Dedup is by normalized feature NAME only, not `(name, detail)` — a session
 * that exercises several detail variants of one feature still contributes a
 * single first use.
 *
 * Zero persistence — all state is in-memory only. Cleared on session end
 * (mirrors {@link FunnelTracker}); it deliberately SURVIVES buffer flushes so a
 * feature used once but flushed mid-session is not re-marked as a first use.
 */
export declare class FeatureReachTracker {
    /** Set of normalized feature names already seen this session */
    private seen;
    /**
     * Check and record the first use of a feature name this session.
     *
     * @returns true if this is the first use of the name this session, false otherwise
     */
    firstUse(name: string): boolean;
    /** Clear all first-use state (call on session end). */
    clear(): void;
}
