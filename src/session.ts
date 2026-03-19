/**
 * In-memory session state manager.
 *
 * Tracks session start time and depth (number of non-session events).
 *
 * Zero persistence — all state is in-memory only.
 */
export class SessionManager {
  private startTime: number = 0;
  private depth: number = 0;
  private active: boolean = false;

  /** Start a new session. Returns true if a new session was started. */
  start(): boolean {
    if (this.active) return false;

    this.startTime = Date.now();
    this.depth = 0;
    this.active = true;
    return true;
  }

  /** Record activity (non-session event). Increments depth. */
  recordActivity(): void {
    if (!this.active) return;
    this.depth++;
  }

  /** End the current session. Returns session duration in seconds and depth, or null if no active session. */
  end(): { duration: number; depth: number } | null {
    if (!this.active) return null;

    this.active = false;

    const durationMs = Date.now() - this.startTime;
    const duration = Math.round(durationMs / 1000);

    return { duration, depth: this.depth };
  }

  /** Whether a session is currently active. */
  get isActive(): boolean {
    return this.active;
  }

  /** Current session depth. */
  get currentDepth(): number {
    return this.depth;
  }

  /** Clean up. */
  destroy(): void {
    this.active = false;
  }
}
