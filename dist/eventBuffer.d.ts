import type { TracklessEvent, EventPayload, EventContext, Environment } from "./types.js";
/**
 * Event buffer with client-side rollup.
 *
 * Count-aggregatable events (feature, view, error, session duration)
 * are rolled up by key. Performance events append to durations[].
 * Non-aggregatable events (funnel, session start/end) are appended individually.
 */
export declare class EventBuffer {
    /** Aggregated events keyed by rollup key */
    private aggregated;
    /** Non-aggregatable events (funnel steps, session start/end) */
    private individual;
    private readonly maxItems;
    constructor(maxItems?: number);
    /** Add an event to the buffer. Returns true if accepted. */
    add(event: TracklessEvent): boolean;
    private addCountable;
    private addPerformance;
    /** Drain the buffer into an EventPayload and clear it. */
    drain(environment: Environment, context: EventContext): EventPayload[];
    /** Clear the buffer without draining */
    clear(): void;
    /** Total number of unique items in the buffer */
    get totalSize(): number;
    /** Check if the buffer is empty */
    get isEmpty(): boolean;
    /** Build the rollup key for count-aggregatable events */
    private rollupKey;
}
