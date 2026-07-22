/**
 * In-memory session state manager.
 *
 * Tracks session start time and depth (number of non-session events).
 *
 * Zero persistence — all state is in-memory only.
 */
export declare class SessionManager {
    private startTime;
    private depth;
    private active;
    /** Start a new session. Returns true if a new session was started. */
    start(): boolean;
    /** Record activity (non-session event). Increments depth. */
    recordActivity(): void;
    /** End the current session. Returns session duration in seconds and depth, or null if no active session. */
    end(): {
        duration: number;
        depth: number;
    } | null;
    /** Whether a session is currently active. */
    get isActive(): boolean;
    /** Current session depth. */
    get currentDepth(): number;
    /** Clean up. */
    destroy(): void;
}
