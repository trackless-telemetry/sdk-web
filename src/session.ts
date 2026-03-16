/** Session inactivity timeout: 30 minutes */
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * In-memory session state manager.
 *
 * Tracks session start time, depth (number of non-session events),
 * and inactivity timeout for new session detection.
 *
 * Zero persistence — all state is in-memory only.
 */
export class SessionManager {
  private startTime: number = 0;
  private depth: number = 0;
  private lastActivityTime: number = 0;
  private active: boolean = false;
  private inactivityTimer: ReturnType<typeof setTimeout> | null = null;

  /** Start a new session. Returns true if a new session was started. */
  start(): boolean {
    if (this.active && !this.isExpired()) return false;

    this.startTime = Date.now();
    this.depth = 0;
    this.lastActivityTime = Date.now();
    this.active = true;
    this.resetInactivityTimer();
    return true;
  }

  /** Record activity (non-session event). Increments depth and resets inactivity timer. */
  recordActivity(): void {
    if (!this.active) return;
    this.depth++;
    this.lastActivityTime = Date.now();
    this.resetInactivityTimer();
  }

  /** End the current session. Returns session duration in seconds and depth, or null if no active session. */
  end(): { duration: number; depth: number } | null {
    if (!this.active) return null;

    this.active = false;
    this.clearInactivityTimer();

    const durationMs = Date.now() - this.startTime;
    const duration = Math.round(durationMs / 1000);

    return { duration, depth: this.depth };
  }

  /** Check if session has expired due to inactivity. */
  isExpired(): boolean {
    if (!this.active) return true;
    return Date.now() - this.lastActivityTime >= INACTIVITY_TIMEOUT_MS;
  }

  /** Whether a session is currently active. */
  get isActive(): boolean {
    return this.active && !this.isExpired();
  }

  /** Current session depth. */
  get currentDepth(): number {
    return this.depth;
  }

  /** Set the callback for when inactivity timeout fires. */
  onTimeout: (() => void) | null = null;

  private resetInactivityTimer(): void {
    this.clearInactivityTimer();
    this.inactivityTimer = setTimeout(() => {
      if (this.onTimeout) this.onTimeout();
    }, INACTIVITY_TIMEOUT_MS);
  }

  private clearInactivityTimer(): void {
    if (this.inactivityTimer !== null) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
  }

  /** Clean up timers. */
  destroy(): void {
    this.clearInactivityTimer();
    this.active = false;
  }
}
