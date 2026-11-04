/**
 * Trackless Web SDK — timers: startTimer / stopTimer / cancelTimer and measure.
 * Mirrors the Swift TimerTests and the Android TimerTest.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Trackless } from "../src/Trackless.js";
import type { TracklessConfig } from "../src/types.js";
import { OpenTimers, MAX_OPEN_TIMERS, MAX_TIMER_ELAPSED_SECONDS } from "../src/timers.js";

const TEST_API_KEY = "tl_0123456789abcdef0123456789abcdef";
const OTHER_API_KEY = "tl_fedcba9876543210fedcba9876543210";

function configure(overrides: Partial<TracklessConfig> = {}): void {
  Trackless.configure({
    apiKey: TEST_API_KEY,
    endpoint: "https://api.test.com",
    flushIntervalSeconds: 999_999,
    ...overrides,
  });
}

let fetchSpy: ReturnType<typeof vi.fn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
/** Hand-driven `performance.now()`, in milliseconds. */
let nowMs = 0;

function advance(seconds: number): void {
  nowMs += seconds * 1000;
}

interface SentEvent {
  type: string;
  name: string;
  durations?: number[];
  threshold?: number;
}

/** Flush, then every performance event sent so far. */
async function sentPerformance(): Promise<SentEvent[]> {
  await Trackless.flush();
  return fetchSpy.mock.calls
    .flatMap((call) => JSON.parse(call[1].body).events as SentEvent[])
    .filter((e) => e.type === "performance");
}

function warnings(): string[] {
  return warnSpy.mock.calls.map((call: unknown[]) => String(call[0]));
}

function setVisibility(state: "hidden" | "visible"): void {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    writable: true,
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  nowMs = 1_000_000;
  vi.spyOn(performance, "now").mockImplementation(() => nowMs);
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  fetchSpy = vi.fn().mockResolvedValue({
    status: 200,
    json: () => Promise.resolve({ accepted: 1, rejected: 0 }),
  });
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(async () => {
  await Trackless.destroy();
  setVisibility("visible");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("OpenTimers", () => {
  it("reads performance.now() by default", () => {
    const timers = new OpenTimers();
    timers.start("a");
    advance(2);
    expect(timers.stop("a")).toBe(2);
  });
});

describe("startTimer / stopTimer", () => {
  it("sends the elapsed time and threshold as a performance measurement", async () => {
    configure();
    Trackless.startTimer("checkout");
    advance(1.5);
    Trackless.stopTimer("checkout", 2.0);

    const events = await sentPerformance();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ name: "checkout", durations: [1.5], threshold: 2.0 });
  });

  it("normalizes the name at start, so a differently written stop closes it", async () => {
    configure();
    Trackless.startTimer("Checkout Flow");
    advance(3);
    Trackless.stopTimer("checkout_flow");

    const events = await sentPerformance();
    expect(events.map((e) => e.name)).toEqual(["checkout_flow"]);
    expect(events[0].durations).toEqual([3]);
  });

  it("sends nothing for a stop with no open timer", async () => {
    configure();
    Trackless.stopTimer("never_started");
    Trackless.startTimer("once");
    Trackless.stopTimer("once");
    Trackless.stopTimer("once");

    const events = await sentPerformance();
    expect(events).toHaveLength(1);
    expect(events[0].durations).toHaveLength(1);
  });

  it("cancelTimer drops the timer and sends nothing", async () => {
    configure();
    Trackless.startTimer("upload");
    advance(2);
    Trackless.cancelTimer("Upload");
    Trackless.stopTimer("upload");

    expect(await sentPerformance()).toEqual([]);
  });

  it("restarts a name that is already open", async () => {
    configure();
    Trackless.startTimer("search");
    advance(10);
    Trackless.startTimer("search");
    advance(4);
    Trackless.stopTimer("search");

    expect((await sentPerformance())[0].durations).toEqual([4]);
  });

  it("keeps a timer started before the first configure", async () => {
    Trackless.startTimer("launch");
    configure();
    advance(0.75);
    Trackless.stopTimer("launch");

    expect((await sentPerformance())[0].durations).toEqual([0.75]);
  });
});

describe("timer cap", () => {
  it("ignores a start past 50 open timers, with one warning", async () => {
    configure();
    for (let i = 0; i < MAX_OPEN_TIMERS; i++) Trackless.startTimer(`timer_${i}`);
    Trackless.startTimer("one_too_many");
    Trackless.startTimer("two_too_many");

    expect(warnings().filter((w) => w.includes("timers are already open"))).toHaveLength(1);

    // Restarting an open name is not a new timer, so it is allowed at the cap.
    Trackless.startTimer("timer_0");
    Trackless.stopTimer("one_too_many");
    Trackless.stopTimer("timer_0");
    expect((await sentPerformance()).map((e) => e.name)).toEqual(["timer_0"]);
  });

  it("re-arms the cap warning after the session ends", () => {
    configure();
    for (let i = 0; i <= MAX_OPEN_TIMERS; i++) Trackless.startTimer(`timer_${i}`);
    setVisibility("hidden");
    setVisibility("visible");
    for (let i = 0; i <= MAX_OPEN_TIMERS; i++) Trackless.startTimer(`timer_${i}`);

    expect(warnings().filter((w) => w.includes("timers are already open"))).toHaveLength(2);
  });
});

describe("session end discards open timers", () => {
  it("discards them when the page is hidden", async () => {
    configure();
    Trackless.startTimer("checkout");
    setVisibility("hidden");
    setVisibility("visible");
    advance(1);
    Trackless.stopTimer("checkout");

    expect(await sentPerformance()).toEqual([]);
  });

  it("discards them on setEnabled(false)", async () => {
    configure();
    Trackless.startTimer("checkout");
    Trackless.setEnabled(false);
    Trackless.setEnabled(true);
    advance(1);
    Trackless.stopTimer("checkout");

    expect(await sentPerformance()).toEqual([]);
  });

  it("discards them on a reconfigure with changed settings, and keeps them on identical settings", async () => {
    configure();
    Trackless.startTimer("kept");
    configure();
    advance(1);
    Trackless.stopTimer("kept");
    expect((await sentPerformance()).map((e) => e.name)).toEqual(["kept"]);

    Trackless.startTimer("dropped");
    configure({ apiKey: OTHER_API_KEY });
    Trackless.stopTimer("dropped");
    expect((await sentPerformance()).map((e) => e.name)).toEqual(["kept"]);
  });

  it("discards them on destroy()", async () => {
    configure();
    Trackless.startTimer("checkout");
    await Trackless.destroy();
    configure();
    Trackless.stopTimer("checkout");

    expect(await sentPerformance()).toEqual([]);
  });
});

describe("elapsed bounds", () => {
  it("drops a negative elapsed time", async () => {
    configure();
    Trackless.startTimer("checkout");
    nowMs -= 5000;
    Trackless.stopTimer("checkout");

    expect(await sentPerformance()).toEqual([]);
    expect(warnings().some((w) => w.includes("checkout") && w.includes("outside"))).toBe(true);
  });

  it("drops an elapsed time over a day and keeps exactly a day", async () => {
    configure();
    Trackless.startTimer("too_long");
    advance(MAX_TIMER_ELAPSED_SECONDS + 1);
    Trackless.stopTimer("too_long");

    Trackless.startTimer("a_day");
    advance(MAX_TIMER_ELAPSED_SECONDS);
    Trackless.stopTimer("a_day");

    const events = await sentPerformance();
    expect(events.map((e) => e.name)).toEqual(["a_day"]);
    expect(events[0].durations).toEqual([MAX_TIMER_ELAPSED_SECONDS]);
  });
});

describe("invalid names and not recording", () => {
  it("ignores a name normalization rejects, with the usual warning and onError", async () => {
    const onError = vi.fn();
    configure({ onError });
    Trackless.startTimer("日本語");
    Trackless.stopTimer("日本語");
    Trackless.cancelTimer("日本語");

    expect(warnings().filter((w) => w.includes("event name rejected"))).toHaveLength(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(await sentPerformance()).toEqual([]);
  });

  it("sends nothing for a timer stopped while disabled", async () => {
    configure();
    Trackless.setEnabled(false);
    Trackless.startTimer("checkout");
    advance(1);
    Trackless.stopTimer("checkout");

    expect(await sentPerformance()).toEqual([]);
  });

  it("never throws into the host app", () => {
    expect(() => Trackless.startTimer(undefined as unknown as string)).not.toThrow();
    expect(() =>
      Trackless.stopTimer(null as unknown as string, "x" as unknown as number),
    ).not.toThrow();
    expect(() => Trackless.cancelTimer(42 as unknown as string)).not.toThrow();
  });
});

describe("measure", () => {
  it("returns a sync function's value and sends its duration", async () => {
    configure();
    const value = Trackless.measure(
      "Parse CSV",
      () => {
        advance(0.25);
        return 42;
      },
      0.5,
    );

    expect(value).toBe(42);
    const events = await sentPerformance();
    expect(events[0]).toMatchObject({ name: "parse_csv", durations: [0.25], threshold: 0.5 });
  });

  it("awaits a returned promise and resolves with its value", async () => {
    configure();
    const pending = Trackless.measure("feed_load", async () => {
      await Promise.resolve();
      advance(1.25);
      return "feed";
    });

    expect(pending).toBeInstanceOf(Promise);
    expect(await pending).toBe("feed");
    const events = await sentPerformance();
    expect(events[0]).toMatchObject({ name: "feed_load", durations: [1.25] });
  });

  it("sends nothing when fn throws, and rethrows", async () => {
    configure();
    expect(() =>
      Trackless.measure("parse", () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(await sentPerformance()).toEqual([]);
  });

  it("sends nothing when the promise rejects, and passes the rejection on", async () => {
    configure();
    await expect(
      Trackless.measure("feed_load", () => Promise.reject(new Error("offline"))),
    ).rejects.toThrow("offline");
    expect(await sentPerformance()).toEqual([]);
  });

  it("sends nothing when the session ends before the promise resolves", async () => {
    configure();
    let resolve!: (v: string) => void;
    const pending = Trackless.measure("feed_load", () => new Promise<string>((r) => (resolve = r)));
    setVisibility("hidden");
    setVisibility("visible");
    advance(1);
    resolve("late");

    expect(await pending).toBe("late");
    expect(await sentPerformance()).toEqual([]);
  });

  it("does not count toward the open-timer cap", async () => {
    configure();
    for (let i = 0; i < MAX_OPEN_TIMERS; i++) Trackless.startTimer(`timer_${i}`);
    Trackless.measure("nested", () => advance(1));

    expect((await sentPerformance()).map((e) => e.name)).toEqual(["nested"]);
    expect(warnings().some((w) => w.includes("timers are already open"))).toBe(false);
  });
});
