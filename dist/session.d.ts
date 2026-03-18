/**
 * In-memory session state manager.
 *
 * Tracks session start time, depth (number of non-session events),
 * and inactivity timeout for new session detection.
 *
 * Zero persistence — all state is in-memory only.
 */
export declare class SessionManager {
    private startTime;
    private depth;
    private lastActivityTime;
    private active;
    private inactivityTimer;
    /** Start a new session. Returns true if a new session was started. */
    start(): boolean;
    /** Record activity (non-session event). Increments depth and resets inactivity timer. */
    recordActivity(): void;
    /** End the current session. Returns session duration in seconds and depth, or null if no active session. */
    end(): {
        duration: number;
        depth: number;
    } | null;
    /** Check if session has expired due to inactivity. */
    isExpired(): boolean;
    /** Whether a session is currently active. */
    get isActive(): boolean;
    /** Current session depth. */
    get currentDepth(): number;
    /** Set the callback for when inactivity timeout fires. */
    onTimeout: (() => void) | null;
    private resetInactivityTimer;
    private clearInactivityTimer;
    /** Clean up timers. */
    destroy(): void;
}
