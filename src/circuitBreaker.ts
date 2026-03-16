/**
 * Circuit breaker with exponential backoff for flush failures.
 *
 * Only 5xx and network errors trigger backoff.
 * 4xx errors discard the batch but do NOT trigger the circuit breaker.
 * A single successful flush resets the failure count and backoff to zero.
 */

/** Backoff delays: 30s, 1m, 5m, 15m, 60m */
const DELAYS_MS = [30_000, 60_000, 300_000, 900_000, 3_600_000] as const;

export class CircuitBreaker {
  private consecutiveFailures = 0;
  private nextRetryAt = 0;

  /** Can we attempt a flush right now? */
  canAttempt(): boolean {
    if (this.consecutiveFailures === 0) return true;
    return Date.now() >= this.nextRetryAt;
  }

  /** Record a successful flush — resets backoff entirely */
  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.nextRetryAt = 0;
  }

  /** Record a flush failure — advances backoff schedule */
  recordFailure(): void {
    this.consecutiveFailures++;
    const delayIndex = Math.min(this.consecutiveFailures - 1, DELAYS_MS.length - 1);
    this.nextRetryAt = Date.now() + DELAYS_MS[delayIndex];
  }

  /** Current consecutive failure count (for testing) */
  get failures(): number {
    return this.consecutiveFailures;
  }
}
