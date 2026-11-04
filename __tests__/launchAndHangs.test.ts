/**
 * Trackless Web SDK — `measureLaunch`, `detectHangs` and the reserved
 * `trackless.` prefix. Mirrors the Swift LaunchAndHangTests and the Android
 * LaunchAndHangTest.
 *
 * Each test imports a fresh copy of the SDK (`vi.resetModules()`), because the
 * launch probe and the reserved-prefix warning are once per page load. The
 * navigation entry and `PerformanceObserver` are stubs a test drives by hand.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TracklessConfig } from "../src/types.js";

type TracklessClass = typeof import("../src/Trackless.js").Trackless;

const TEST_API_KEY = "tl_0123456789abcdef0123456789abcdef";
const OTHER_API_KEY = "tl_fedcba9876543210fedcba9876543210";

let Trackless: TracklessClass;
let fetchSpy: ReturnType<typeof vi.fn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

/** The page's navigation entry, as `performance.getEntriesByType("navigation")` returns it. */
let navigation: { startTime: number; loadEventStart: number; activationStart?: number } | null;
/** The page's `visibility-state` entries, as Chromium records them. */
let visibilityEntries: { name: string; startTime: number }[];
const originalGetEntriesByType = performance.getEntriesByType;

interface SentEvent {
  type: string;
  name: string;
  durations?: number[];
  threshold?: number;
  stepIndex?: number;
}

// ── PerformanceObserver stub ────────────────────────────────────────────

class FakeObserver {
  static supportedEntryTypes: string[] = ["longtask"];
  static instances: FakeObserver[] = [];
  options: PerformanceObserverInit | null = null;
  connected = false;

  constructor(private readonly callback: PerformanceObserverCallback) {
    FakeObserver.instances.push(this);
  }

  observe(options: PerformanceObserverInit): void {
    this.options = options;
    this.connected = true;
  }

  disconnect(): void {
    this.connected = false;
  }

  /** Deliver long-task entries of these durations, in milliseconds. */
  emit(...durations: number[]): void {
    const entries = durations.map((duration) => ({ entryType: "longtask", duration }));
    this.callback(
      { getEntries: () => entries } as unknown as PerformanceObserverEntryList,
      this as unknown as PerformanceObserver,
    );
  }
}

function liveObservers(): FakeObserver[] {
  return FakeObserver.instances.filter((o) => o.connected);
}

// ── Helpers ─────────────────────────────────────────────────────────────

function configure(overrides: Partial<TracklessConfig> = {}): void {
  Trackless.configure({
    apiKey: TEST_API_KEY,
    endpoint: "https://api.test.com",
    flushIntervalSeconds: 999_999,
    ...overrides,
  });
}

function sentEvents(): SentEvent[] {
  return fetchSpy.mock.calls.flatMap((call) => JSON.parse(call[1].body).events as SentEvent[]);
}

async function sentPerformance(): Promise<SentEvent[]> {
  await Trackless.flush();
  return sentEvents().filter((e) => e.type === "performance");
}

function warnings(): string[] {
  return warnSpy.mock.calls.map((call: unknown[]) => String(call[0]));
}

function reservedWarnings(): string[] {
  return warnings().filter((w) => w.includes("reserved"));
}

function setVisibility(state: "hidden" | "visible"): void {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    writable: true,
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

function fireLoad(loadEventStartMs: number): void {
  navigation = { startTime: 0, loadEventStart: loadEventStartMs };
  window.dispatchEvent(new Event("load"));
}

beforeEach(async () => {
  vi.resetModules();
  ({ Trackless } = await import("../src/Trackless.js"));
  navigation = { startTime: 0, loadEventStart: 1250 };
  visibilityEntries = [];
  Object.defineProperty(performance, "getEntriesByType", {
    value: (type: string) => {
      if (type === "navigation") return navigation ? [navigation] : [];
      if (type === "visibility-state") return visibilityEntries;
      return [];
    },
    configurable: true,
    writable: true,
  });
  FakeObserver.supportedEntryTypes = ["longtask"];
  FakeObserver.instances = [];
  vi.stubGlobal("PerformanceObserver", FakeObserver);
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  fetchSpy = vi.fn().mockResolvedValue({
    status: 200,
    json: () => Promise.resolve({ accepted: 1, rejected: 0 }),
  });
  vi.stubGlobal("fetch", fetchSpy);
  setVisibility("visible");
});

afterEach(async () => {
  await Trackless.destroy();
  setVisibility("visible");
  delete (document as Document & { prerendering?: boolean }).prerendering;
  Object.defineProperty(performance, "getEntriesByType", {
    value: originalGetEntriesByType,
    configurable: true,
    writable: true,
  });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── Launch ──────────────────────────────────────────────────────────────

describe("measureLaunch", () => {
  it("is off by default: nothing is sent", async () => {
    configure();
    expect(await sentPerformance()).toEqual([]);
  });

  it("reads the navigation entry when load already fired at configure()", async () => {
    configure({ measureLaunch: true });
    const events = await sentPerformance();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ name: "trackless.launch", durations: [1.25] });
    expect(events[0].threshold).toBeUndefined();
  });

  it("passes launchThresholdSeconds through as the threshold", async () => {
    configure({ measureLaunch: true, launchThresholdSeconds: 3 });
    const events = await sentPerformance();
    expect(events[0]).toMatchObject({ durations: [1.25], threshold: 3 });
  });

  it("ignores a threshold that is not a positive number, with a warning", async () => {
    configure({ measureLaunch: true, launchThresholdSeconds: 0 });
    const events = await sentPerformance();
    expect(events[0].threshold).toBeUndefined();
    expect(warnings().some((w) => w.includes("launchThresholdSeconds"))).toBe(true);
  });

  it("waits for the load event when it has not fired yet", async () => {
    navigation = { startTime: 0, loadEventStart: 0 };
    configure({ measureLaunch: true });
    expect(await sentPerformance()).toEqual([]);

    fireLoad(2000);
    const events = await sentPerformance();
    expect(events.map((e) => e.durations)).toEqual([[2]]);
  });

  it("is sent once per page load, whatever configure() does next", async () => {
    configure({ measureLaunch: true });
    configure({ measureLaunch: true }); // identical
    configure({ measureLaunch: true, apiKey: OTHER_API_KEY }); // changed
    await Trackless.destroy();
    configure({ measureLaunch: true });

    const launches = (await sentPerformance()).filter((e) => e.name === "trackless.launch");
    expect(launches.flatMap((e) => e.durations)).toEqual([1.25]);
  });

  it("does not count a soft navigation as a launch", async () => {
    configure({ measureLaunch: true, autoScreenTracking: true });
    history.pushState({}, "", "/settings");
    window.dispatchEvent(new Event("load")); // even a stray load event
    const launches = (await sentPerformance()).filter((e) => e.name === "trackless.launch");
    expect(launches).toHaveLength(1);
  });

  it("does nothing where the browser has no navigation entry", async () => {
    navigation = null;
    configure({ measureLaunch: true });
    window.dispatchEvent(new Event("load"));
    expect(await sentPerformance()).toEqual([]);
  });

  it("is not sent when measured while recording is disabled, even after re-enabling", async () => {
    configure({ measureLaunch: true, enabled: false });
    Trackless.setEnabled(true);
    configure({ measureLaunch: true });
    expect(await sentPerformance()).toEqual([]);
  });

  it("is dropped when a reconfigure turned measureLaunch off before load", async () => {
    navigation = { startTime: 0, loadEventStart: 0 };
    configure({ measureLaunch: true });
    configure({ measureLaunch: false });
    fireLoad(900);
    expect(await sentPerformance()).toEqual([]);
  });

  it("drops a value outside 0 to 86,400 seconds", async () => {
    navigation = { startTime: 0, loadEventStart: 86_401_000 };
    configure({ measureLaunch: true });
    expect(await sentPerformance()).toEqual([]);
  });

  it("drops a launch longer than 60 seconds and sends one of exactly 60", async () => {
    navigation = { startTime: 0, loadEventStart: 60_001 };
    configure({ measureLaunch: true });
    expect(await sentPerformance()).toEqual([]);

    vi.resetModules();
    ({ Trackless } = await import("../src/Trackless.js"));
    navigation = { startTime: 0, loadEventStart: 60_000 };
    configure({ measureLaunch: true });
    const events = await sentPerformance();
    expect(events.map((e) => e.durations)).toEqual([[60]]);
  });

  it("drops a launch over 60 seconds measured at the load event", async () => {
    navigation = { startTime: 0, loadEventStart: 0 };
    configure({ measureLaunch: true });
    fireLoad(75_000);
    expect(await sentPerformance()).toEqual([]);
  });

  it("drops a negative launch", async () => {
    navigation = { startTime: 500, loadEventStart: 400 };
    configure({ measureLaunch: true });
    expect(await sentPerformance()).toEqual([]);
  });

  it("skips a page that is prerendering at configure()", async () => {
    navigation = { startTime: 0, loadEventStart: 0 };
    Object.defineProperty(document, "prerendering", { value: true, configurable: true });
    configure({ measureLaunch: true });
    fireLoad(800);
    expect(await sentPerformance()).toEqual([]);
  });

  it("skips a page whose navigation entry shows it was prerendered and activated", async () => {
    navigation = { startTime: 0, loadEventStart: 800, activationStart: 4200 };
    configure({ measureLaunch: true });
    expect(await sentPerformance()).toEqual([]);
  });

  it("skips a page hidden at configure() before load", async () => {
    navigation = { startTime: 0, loadEventStart: 0 };
    setVisibility("hidden");
    configure({ measureLaunch: true });
    setVisibility("visible");
    fireLoad(900);
    expect(await sentPerformance()).toEqual([]);
  });

  it("skips a page that goes hidden between configure() and load", async () => {
    navigation = { startTime: 0, loadEventStart: 0 };
    configure({ measureLaunch: true });
    setVisibility("hidden");
    setVisibility("visible");
    fireLoad(900);
    expect(await sentPerformance()).toEqual([]);
  });

  it("skips a page with a visibility-state hidden entry at or before loadEventStart", async () => {
    FakeObserver.supportedEntryTypes = ["longtask", "visibility-state"];
    visibilityEntries = [
      { name: "visible", startTime: 0 },
      { name: "hidden", startTime: 1250 },
      { name: "visible", startTime: 1300 },
    ];
    configure({ measureLaunch: true });
    expect(await sentPerformance()).toEqual([]);
  });

  it("uses visibility-state entries over the current state where they exist", async () => {
    // Load fired, then the page was hidden: the entries show it was visible
    // through load, so the launch is sent although the page is hidden now.
    FakeObserver.supportedEntryTypes = ["longtask", "visibility-state"];
    visibilityEntries = [
      { name: "visible", startTime: 0 },
      { name: "hidden", startTime: 1251 },
    ];
    setVisibility("hidden");
    configure({ measureLaunch: true });
    const events = await sentPerformance();
    expect(events.map((e) => e.durations)).toEqual([[1.25]]);
  });

  it("still sends a launch when the page is hidden only after load", async () => {
    navigation = { startTime: 0, loadEventStart: 0 };
    configure({ measureLaunch: true });
    fireLoad(900);
    setVisibility("hidden");
    setVisibility("visible");
    const events = await sentPerformance();
    expect(events.map((e) => e.durations)).toEqual([[0.9]]);
  });

  it("removes its visibilitychange listener when load fires", async () => {
    navigation = { startTime: 0, loadEventStart: 0 };
    const removed = vi.spyOn(document, "removeEventListener");
    configure({ measureLaunch: true });
    fireLoad(900);
    expect(removed.mock.calls.some((call) => call[0] === "visibilitychange")).toBe(true);
  });

  it("leaves the session's depth alone", async () => {
    configure({ measureLaunch: true });
    setVisibility("hidden");
    await Promise.resolve();
    const end = sentEvents().find((e) => e.type === "session" && e.name === "end");
    expect(end?.stepIndex).toBe(0);
  });

  it("counts as a changed setting, as does detectHangs", async () => {
    configure();
    Trackless.startTimer("open");
    configure({ detectHangs: true });
    Trackless.stopTimer("open");
    Trackless.startTimer("open");
    configure({ detectHangs: true, measureLaunch: true });
    Trackless.stopTimer("open");
    expect((await sentPerformance()).filter((e) => e.name === "open")).toEqual([]);
  });
});

// ── Hangs ───────────────────────────────────────────────────────────────

describe("detectHangs", () => {
  it("is off by default: no observer is created", () => {
    configure();
    expect(FakeObserver.instances).toHaveLength(0);
  });

  it("observes longtask entries, not buffered, and sends each of 250 ms or more", async () => {
    configure({ detectHangs: true });
    const [observer] = liveObservers();
    expect(observer.options).toEqual({ type: "longtask", buffered: false });

    observer.emit(120, 249, 250, 400);
    const events = await sentPerformance();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ name: "trackless.hang", durations: [0.25, 0.4] });
    expect(events[0].threshold).toBeUndefined();
  });

  it("does nothing, silently, where longtask is unsupported", async () => {
    FakeObserver.supportedEntryTypes = ["navigation"];
    configure({ detectHangs: true });
    expect(FakeObserver.instances).toHaveLength(0);

    vi.stubGlobal("PerformanceObserver", undefined);
    configure({ detectHangs: true, apiKey: OTHER_API_KEY });
    expect(warnings()).toEqual([]);
  });

  it("stops while the page is hidden and starts again when it is visible", () => {
    configure({ detectHangs: true });
    expect(liveObservers()).toHaveLength(1);
    setVisibility("hidden");
    expect(liveObservers()).toHaveLength(0);
    setVisibility("visible");
    expect(liveObservers()).toHaveLength(1);
  });

  it("does not start while the page is hidden at configure()", () => {
    setVisibility("hidden");
    configure({ detectHangs: true });
    expect(liveObservers()).toHaveLength(0);
    setVisibility("visible");
    expect(liveObservers()).toHaveLength(1);
  });

  it("stops at setEnabled(false), a reconfigure without it, and destroy()", async () => {
    configure({ detectHangs: true });
    Trackless.setEnabled(false);
    expect(liveObservers()).toHaveLength(0);
    Trackless.setEnabled(true);
    expect(liveObservers()).toHaveLength(1);
    configure({ apiKey: OTHER_API_KEY });
    expect(liveObservers()).toHaveLength(0);
    configure({ detectHangs: true });
    expect(liveObservers()).toHaveLength(1);
    await Trackless.destroy();
    expect(liveObservers()).toHaveLength(0);
  });

  it("never throws into the page when an entry is malformed", () => {
    configure({ detectHangs: true });
    const [observer] = liveObservers();
    expect(() =>
      (observer as unknown as { callback: PerformanceObserverCallback }).callback(
        { getEntries: () => null } as unknown as PerformanceObserverEntryList,
        observer as unknown as PerformanceObserver,
      ),
    ).not.toThrow();
  });
});

// ── Reserved prefix ─────────────────────────────────────────────────────

describe("reserved trackless. prefix", () => {
  it("performance() warns once per page load and sends the name anyway", async () => {
    configure();
    Trackless.performance("Trackless.Custom", 1);
    Trackless.performance("trackless.other", 1);
    Trackless.startTimer("trackless.timer");
    configure({ apiKey: OTHER_API_KEY });
    Trackless.performance("trackless.again", 1);

    expect(reservedWarnings()).toHaveLength(1);
    expect(reservedWarnings()[0]).toContain("trackless.custom");
    const names = (await sentPerformance()).map((e) => e.name);
    expect(names).toEqual(expect.arrayContaining(["trackless.custom", "trackless.other"]));
  });

  it("startTimer() warns", () => {
    configure();
    Trackless.startTimer("trackless.checkout");
    expect(reservedWarnings()).toHaveLength(1);
  });

  it("measure() warns and sends", async () => {
    configure();
    Trackless.measure("trackless.parse", () => 1);
    expect(reservedWarnings()).toHaveLength(1);
    expect((await sentPerformance()).map((e) => e.name)).toEqual(["trackless.parse"]);
  });

  it("is not triggered by the SDK's own launch and hang sends", async () => {
    configure({ measureLaunch: true, detectHangs: true });
    liveObservers()[0].emit(300);
    expect((await sentPerformance()).map((e) => e.name).sort()).toEqual([
      "trackless.hang",
      "trackless.launch",
    ]);
    expect(reservedWarnings()).toEqual([]);

    Trackless.performance("trackless.mine", 1);
    expect(reservedWarnings()).toHaveLength(1);
  });
});
