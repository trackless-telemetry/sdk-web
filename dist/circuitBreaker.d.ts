/**
 * Circuit breaker with exponential backoff for flush failures.
 *
 * Only 5xx and network errors trigger backoff.
 * 4xx errors discard the batch but do NOT trigger the circuit breaker.
 * A single successful flush resets the failure count and backoff to zero.
 */
export declare class CircuitBreaker {
    private consecutiveFailures;
    private nextRetryAt;
    /** Can we attempt a flush right now? */
    canAttempt(): boolean;
    /** Record a successful flush — resets backoff entirely */
    recordSuccess(): void;
    /** Record a flush failure — advances backoff schedule */
    recordFailure(): void;
    /** Current consecutive failure count (for testing) */
    get failures(): number;
}
