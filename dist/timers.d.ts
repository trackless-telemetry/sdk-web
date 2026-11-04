/**
 * The open timers behind `Trackless.startTimer()` / `stopTimer()`, in memory
 * only — never cookies, localStorage, sessionStorage or IndexedDB.
 *
 * **Clock.** `performance.now()`: monotonic and unaffected by the user or the
 * network changing the wall clock. `Date.now()` is the fallback only where
 * `performance` does not exist. `Trackless` still drops anything outside
 * `0..1 day`, so the three SDKs share one rule.
 *
 * **Discard.** Session end (the page hidden), `setEnabled(false)`, a
 * reconfigure and `destroy()` call `discardAll()`: a timer that spans a hidden
 * tab would measure time nobody was looking at the page. Each start, and each
 * `measure()` call, takes a sequence number; a discard records the highest one
 * it covers, so a `measure()` whose promise was pending when the session ended
 * sends nothing either.
 */
/** At most this many timers are open at once. A start past it is ignored. */
export declare const MAX_OPEN_TIMERS = 50;
/** Elapsed times above this — one day — are dropped. */
export declare const MAX_TIMER_ELAPSED_SECONDS = 86400;
/** A started timer, or the start of one `measure()` call. */
export interface TimerStart {
    readonly atMs: number;
    readonly sequence: number;
}
/** Outcome of a start. `capReached` carries whether this is the first refusal since the last discard. */
export type TimerStartResult = "started" | "restarted" | {
    capReached: true;
    shouldWarn: boolean;
};
export declare class OpenTimers {
    private readonly clock;
    private readonly open;
    private sequence;
    private discardedThrough;
    private warnedCap;
    /** @param clock Millisecond clock — injectable for testing. */
    constructor(clock?: () => number);
    /** Start (or restart) the timer for an already-normalized name. */
    start(name: string): TimerStartResult;
    /** Close the timer for an already-normalized name; its elapsed seconds, or null when none is open. */
    stop(name: string): number | null;
    /** Drop the timer for an already-normalized name, if one is open. */
    cancel(name: string): void;
    /** Start one `measure()` call. It does not enter the map or count toward the cap. */
    mark(): TimerStart;
    /** Elapsed seconds since `start`, or null when a discard has happened since. */
    elapsedSince(start: TimerStart): number | null;
    /** Discard every open timer and invalidate every `measure()` in progress. */
    discardAll(): void;
    /** Number of open timers. */
    get size(): number;
}
