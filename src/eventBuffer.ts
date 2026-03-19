import type { TracklessEvent, EventPayload, EventContext, Environment } from "./types.js";

/** Max unique items in the buffer */
const DEFAULT_MAX_ITEMS = 1000;

/** Max events per flush payload */
const MAX_EVENTS_PER_FLUSH = 100;

/**
 * Event buffer with client-side rollup.
 *
 * Count-aggregatable events (feature, view, error, session duration)
 * are rolled up by key. Performance events append to durations[].
 * Non-aggregatable events (funnel, session start/end) are appended individually.
 */
export class EventBuffer {
  /** Aggregated events keyed by rollup key */
  private aggregated: Map<string, TracklessEvent> = new Map();
  /** Non-aggregatable events (funnel steps, session start/end) */
  private individual: TracklessEvent[] = [];
  private readonly maxItems: number;

  constructor(maxItems: number = DEFAULT_MAX_ITEMS) {
    this.maxItems = maxItems;
  }

  /** Add an event to the buffer. Returns true if accepted. */
  add(event: TracklessEvent): boolean {
    // Non-aggregatable types go to individual list
    if (event.type === "funnel" || (event.type === "session" && event.name !== "duration")) {
      if (this.totalSize >= this.maxItems) return false;
      this.individual.push({ ...event });
      return true;
    }

    // Performance events aggregate durations
    if (event.type === "performance") {
      return this.addPerformance(event);
    }

    // Count-aggregatable events
    return this.addCountable(event);
  }

  private addCountable(event: TracklessEvent): boolean {
    const key = this.rollupKey(event);
    const existing = this.aggregated.get(key);

    if (existing) {
      existing.count = (existing.count ?? 1) + (event.count ?? 1);
      return true;
    }

    if (this.totalSize >= this.maxItems) return false;

    this.aggregated.set(key, { ...event, count: event.count ?? 1 });
    return true;
  }

  private addPerformance(event: TracklessEvent): boolean {
    const key = this.rollupKey(event);
    const existing = this.aggregated.get(key);

    if (existing) {
      // Append duration(s) to existing durations array
      if (!existing.durations) existing.durations = [];
      if (event.duration !== undefined) {
        existing.durations.push(event.duration);
      } else if (event.durations) {
        existing.durations.push(...event.durations);
      }
      // Clear single duration field since we use durations array
      delete existing.duration;
      return true;
    }

    if (this.totalSize >= this.maxItems) return false;

    // Convert single duration to durations array
    const newEvent = { ...event };
    if (newEvent.duration !== undefined) {
      newEvent.durations = [newEvent.duration];
      delete newEvent.duration;
    } else if (!newEvent.durations) {
      newEvent.durations = [];
    }

    this.aggregated.set(key, newEvent);
    return true;
  }

  /** Drain the buffer into an EventPayload and clear it. */
  drain(environment: Environment, context: EventContext): EventPayload[] {
    const allEvents: TracklessEvent[] = [...this.aggregated.values(), ...this.individual];

    this.aggregated.clear();
    this.individual = [];

    if (allEvents.length === 0) return [];

    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    // Split into chunks of MAX_EVENTS_PER_FLUSH
    const payloads: EventPayload[] = [];
    for (let i = 0; i < allEvents.length; i += MAX_EVENTS_PER_FLUSH) {
      payloads.push({
        date,
        environment,
        context,
        events: allEvents.slice(i, i + MAX_EVENTS_PER_FLUSH),
      });
    }

    return payloads;
  }

  /** Clear the buffer without draining */
  clear(): void {
    this.aggregated.clear();
    this.individual = [];
  }

  /** Total number of unique items in the buffer */
  get totalSize(): number {
    return this.aggregated.size + this.individual.length;
  }

  /** Check if the buffer is empty */
  get isEmpty(): boolean {
    return this.totalSize === 0;
  }

  /** Build the rollup key for count-aggregatable events */
  private rollupKey(event: TracklessEvent): string {
    switch (event.type) {
      case "feature":
      case "view":
        return `${event.type}|${event.name}|${event.detail ?? ""}`;
      case "error":
        return `${event.type}|${event.name}|${event.severity ?? ""}|${event.code ?? ""}`;
      case "performance":
        return `${event.type}|${event.name}|${event.threshold !== undefined ? String(event.threshold) : ""}`;
      case "session":
        // session duration events are aggregatable by name
        return `${event.type}|${event.name}`;
      default:
        return `${event.type}|${event.name}`;
    }
  }
}
