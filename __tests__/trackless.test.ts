/**
 * Trackless Web SDK — Comprehensive Test Suite
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Trackless } from "../src/Trackless.js";
import type { TracklessConfig } from "../src/types.js";
import { EventBuffer } from "../src/eventBuffer.js";
import { CircuitBreaker } from "../src/circuitBreaker.js";
import { FunnelTracker } from "../src/funnel.js";
import { sanitizeProperties } from "../src/piiGuard.js";
import { SessionManager } from "../src/session.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TEST_API_KEY = "tl_0123456789abcdef0123456789abcdef";
const TEST_ENDPOINT = "https://api.test.com";

function configure(overrides: Partial<TracklessConfig> = {}): void {
  Trackless.configure({
    apiKey: TEST_API_KEY,
    endpoint: TEST_ENDPOINT,
    flushIntervalMs: 999_999, // effectively disable periodic flush in tests
    ...overrides,
  });
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  fetchSpy = vi.fn().mockResolvedValue({
    status: 200,
    json: () => Promise.resolve({ accepted: 1, rejected: 0 }),
  });
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(async () => {
  await Trackless.destroy();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─── 1. EventBuffer Aggregation (6 tests) ────────────────────────────────────

describe("EventBuffer Aggregation", () => {
  it("single feature event creates 1 buffer entry with count 1", () => {
    const buffer = new EventBuffer();
    buffer.add({ type: "feature", name: "export_clicked" });

    expect(buffer.totalSize).toBe(1);
    const payloads = buffer.drain("production", { platform: "web" });
    expect(payloads).toHaveLength(1);
    expect(payloads[0].events).toHaveLength(1);
    expect(payloads[0].events[0].count).toBe(1);
    expect(payloads[0].events[0].name).toBe("export_clicked");
  });

  it("multiple same feature events create 1 entry with count N", () => {
    const buffer = new EventBuffer();
    buffer.add({ type: "feature", name: "export_clicked" });
    buffer.add({ type: "feature", name: "export_clicked" });
    buffer.add({ type: "feature", name: "export_clicked" });

    expect(buffer.totalSize).toBe(1);
    const payloads = buffer.drain("production", { platform: "web" });
    expect(payloads[0].events[0].count).toBe(3);
  });

  it("different feature names create separate buffer entries", () => {
    const buffer = new EventBuffer();
    buffer.add({ type: "feature", name: "export_clicked" });
    buffer.add({ type: "feature", name: "import_clicked" });

    expect(buffer.totalSize).toBe(2);
    const payloads = buffer.drain("production", { platform: "web" });
    expect(payloads[0].events).toHaveLength(2);
  });

  it("different types create separate buffer entries", () => {
    const buffer = new EventBuffer();
    buffer.add({ type: "feature", name: "export" });
    buffer.add({ type: "screen", name: "export" });

    expect(buffer.totalSize).toBe(2);
  });

  it("performance events aggregate durations", () => {
    const buffer = new EventBuffer();
    buffer.add({ type: "performance", name: "api_call", duration: 100 });
    buffer.add({ type: "performance", name: "api_call", duration: 200 });
    buffer.add({ type: "performance", name: "api_call", duration: 150 });

    expect(buffer.totalSize).toBe(1);
    const payloads = buffer.drain("production", { platform: "web" });
    expect(payloads[0].events[0].durations).toEqual([100, 200, 150]);
  });

  it("funnel events are stored individually (not aggregated)", () => {
    const buffer = new EventBuffer();
    buffer.add({ type: "funnel", name: "checkout", step: "cart", stepIndex: 0 });
    buffer.add({ type: "funnel", name: "checkout", step: "payment", stepIndex: 1 });

    expect(buffer.totalSize).toBe(2);
    const payloads = buffer.drain("production", { platform: "web" });
    expect(payloads[0].events).toHaveLength(2);
    expect(payloads[0].events[0].step).toBe("cart");
    expect(payloads[0].events[1].step).toBe("payment");
  });
});

// ─── 2. Flush (5 tests) ─────────────────────────────────────────────────────

describe("Flush", () => {
  it("periodic flush sends buffered events", async () => {
    configure({ flushIntervalMs: 1000 });
    Trackless.feature("export_clicked");

    await vi.advanceTimersByTimeAsync(1000);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0];
    expect(call[0]).toBe(TEST_ENDPOINT);
    const body = JSON.parse(call[1].body);
    // Should contain the feature event (plus session start)
    expect(body.events.some((e: any) => e.name === "export_clicked" && e.type === "feature")).toBe(
      true,
    );
  });

  it("visibility change triggers flush with keepalive", async () => {
    configure();
    Trackless.feature("export_clicked");

    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      writable: true,
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    await vi.advanceTimersByTimeAsync(0);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0];
    expect(call[1].keepalive).toBe(true);

    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });
  });

  it("manual flush() drains buffer", async () => {
    configure();
    Trackless.feature("export_clicked");
    Trackless.feature("import_clicked");

    await Trackless.flush();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.events.length).toBeGreaterThanOrEqual(2);
  });

  it("empty buffer does not make HTTP request", async () => {
    configure();
    // Flush the session:start event first
    await Trackless.flush();
    fetchSpy.mockClear();

    await Trackless.flush();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("flush timeout is counted as failure", async () => {
    fetchSpy.mockImplementation(
      () =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("AbortError")), 15_000);
        }),
    );

    const errors: Error[] = [];
    configure({ onError: (e) => errors.push(e) });
    Trackless.feature("export_clicked");

    const flushPromise = Trackless.flush();
    await vi.advanceTimersByTimeAsync(15_000);
    await flushPromise;

    expect(errors.length).toBe(1);
  });
});

// ─── 3. Event Name Validation (3 tests) ──────────────────────────────────────

describe("Event Name Validation", () => {
  it("invalid event names are silently ignored", () => {
    configure();
    expect(() => Trackless.feature("invalid name with spaces")).not.toThrow();
    expect(() => Trackless.feature("INVALID!")).not.toThrow();
    expect(() => Trackless.feature("a".repeat(101))).not.toThrow();
  });

  it("empty event name is silently ignored", () => {
    configure();
    expect(() => Trackless.feature("")).not.toThrow();
  });

  it("uppercase name is normalized to lowercase", async () => {
    configure();
    // Flush session:start first
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.feature("ExportClicked");
    await Trackless.flush();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.events.some((e: any) => e.name === "exportclicked")).toBe(true);
  });
});

// ─── 4. Circuit Breaker (5 tests) ────────────────────────────────────────────

describe("Circuit Breaker", () => {
  it("5xx response records failure and increases backoff", async () => {
    fetchSpy.mockResolvedValue({
      status: 500,
      json: () => Promise.resolve({}),
    });

    const errors: Error[] = [];
    configure({ onError: (e) => errors.push(e) });
    Trackless.feature("export_clicked");

    await Trackless.flush();

    expect(errors.length).toBe(1);
    expect(errors[0].message).toContain("500");

    // Second flush should be blocked by circuit breaker
    Trackless.feature("import_clicked");
    fetchSpy.mockClear();
    await Trackless.flush();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("network error records failure", async () => {
    fetchSpy.mockRejectedValue(new Error("Network error"));

    const errors: Error[] = [];
    configure({ onError: (e) => errors.push(e) });
    Trackless.feature("export_clicked");

    await Trackless.flush();

    expect(errors.length).toBe(1);
    expect(errors[0].message).toBe("Network error");
  });

  it("4xx response discards batch with NO backoff", async () => {
    fetchSpy.mockResolvedValue({
      status: 400,
      json: () => Promise.resolve({}),
    });

    configure();
    Trackless.feature("export_clicked");
    await Trackless.flush();

    // 4xx should NOT trigger backoff — next flush should be allowed
    Trackless.feature("import_clicked");
    fetchSpy.mockClear();
    fetchSpy.mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ accepted: 1, rejected: 0 }),
    });
    await Trackless.flush();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("success after failures resets backoff", () => {
    const breaker = new CircuitBreaker();

    breaker.recordFailure();
    expect(breaker.failures).toBe(1);

    breaker.recordSuccess();
    expect(breaker.failures).toBe(0);
    expect(breaker.canAttempt()).toBe(true);
  });

  it("during backoff window, flush is skipped", async () => {
    const breaker = new CircuitBreaker();
    breaker.recordFailure();

    expect(breaker.canAttempt()).toBe(false);

    await vi.advanceTimersByTimeAsync(30_001);
    expect(breaker.canAttempt()).toBe(true);
  });
});

// ─── 5. Bounded Memory (2 tests) ────────────────────────────────────────────

describe("Bounded Memory", () => {
  it("buffer at 1000 items silently drops new events", () => {
    const buffer = new EventBuffer(1000);

    for (let i = 0; i < 1000; i++) {
      const added = buffer.add({ type: "feature", name: `feature_${i}` });
      expect(added).toBe(true);
    }
    expect(buffer.totalSize).toBe(1000);

    const added = buffer.add({ type: "feature", name: "new_feature" });
    expect(added).toBe(false);
    expect(buffer.totalSize).toBe(1000);
  });

  it("existing features still accepted when buffer is full", () => {
    const buffer = new EventBuffer(1000);

    for (let i = 0; i < 1000; i++) {
      buffer.add({ type: "feature", name: `feature_${i}` });
    }

    const added = buffer.add({ type: "feature", name: "feature_0" });
    expect(added).toBe(true);

    const payloads = buffer.drain("production", { platform: "web" });
    const allEvents = payloads.flatMap((p) => p.events);
    const feature0 = allEvents.find((e) => e.name === "feature_0");
    expect(feature0?.count).toBe(2);
  });
});

// ─── 6. No Persistence (4 tests) ────────────────────────────────────────────

describe("No Persistence", () => {
  it("no cookies set", () => {
    const originalCookie = document.cookie;
    configure();
    Trackless.feature("export_clicked");
    expect(document.cookie).toBe(originalCookie);
  });

  it("no localStorage used", () => {
    const setItemSpy = vi.spyOn(localStorage, "setItem");
    const getItemSpy = vi.spyOn(localStorage, "getItem");

    configure();
    Trackless.feature("export_clicked");

    expect(setItemSpy).not.toHaveBeenCalled();
    expect(getItemSpy).not.toHaveBeenCalled();

    setItemSpy.mockRestore();
    getItemSpy.mockRestore();
  });

  it("no sessionStorage used", () => {
    const setItemSpy = vi.spyOn(sessionStorage, "setItem");
    const getItemSpy = vi.spyOn(sessionStorage, "getItem");

    configure();
    Trackless.feature("export_clicked");

    expect(setItemSpy).not.toHaveBeenCalled();
    expect(getItemSpy).not.toHaveBeenCalled();

    setItemSpy.mockRestore();
    getItemSpy.mockRestore();
  });

  it("no IndexedDB used", () => {
    const openSpy = vi.fn();
    vi.stubGlobal("indexedDB", { open: openSpy });

    configure();
    Trackless.feature("export_clicked");

    expect(openSpy).not.toHaveBeenCalled();
  });
});

// ─── 7. No Exceptions (3 tests) ─────────────────────────────────────────────

describe("No Exceptions", () => {
  it("event methods never throw", () => {
    configure();

    expect(() => Trackless.feature("valid_name")).not.toThrow();
    expect(() => Trackless.feature("")).not.toThrow();
    expect(() => Trackless.feature("INVALID!@#$")).not.toThrow();
    expect(() => Trackless.feature(null as unknown as string)).not.toThrow();
    expect(() => Trackless.feature(undefined as unknown as string)).not.toThrow();
    expect(() => Trackless.screen("valid")).not.toThrow();
    expect(() => Trackless.selection("choice", "a")).not.toThrow();
    expect(() => Trackless.performance("metric", 100)).not.toThrow();
    expect(() => Trackless.error("crash")).not.toThrow();
    expect(() => Trackless.event("generic")).not.toThrow();
    expect(() => Trackless.funnel("checkout", "step1")).not.toThrow();
  });

  it("flush() never throws (resolves silently)", async () => {
    fetchSpy.mockRejectedValue(new Error("Network failure"));

    configure();
    Trackless.feature("export_clicked");

    await expect(Trackless.flush()).resolves.toBeUndefined();
  });

  it("configure() never throws", () => {
    expect(() =>
      Trackless.configure({
        apiKey: TEST_API_KEY,
        endpoint: TEST_ENDPOINT,
      }),
    ).not.toThrow();

    expect(() =>
      Trackless.configure({
        apiKey: "",
        endpoint: "",
      }),
    ).not.toThrow();

    expect(() => Trackless.configure({} as any)).not.toThrow();
  });
});

// ─── 8. Opt-out (3 tests) ───────────────────────────────────────────────────

describe("Opt-out", () => {
  it("enabled: false means events are silently ignored", async () => {
    configure({ enabled: false });

    Trackless.feature("export_clicked");
    Trackless.feature("import_clicked");

    await Trackless.flush();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("setEnabled(false) at runtime stops events AND discards buffered data", async () => {
    configure();
    Trackless.feature("export_clicked");
    Trackless.feature("import_clicked");

    Trackless.setEnabled(false);

    await Trackless.flush();
    expect(fetchSpy).not.toHaveBeenCalled();

    Trackless.feature("another_event");
    await Trackless.flush();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("setEnabled(true) resumes with empty buffer", async () => {
    configure();
    Trackless.feature("export_clicked");
    Trackless.setEnabled(false);
    Trackless.setEnabled(true);

    // Buffer should be empty after re-enable
    await Trackless.flush();
    expect(fetchSpy).not.toHaveBeenCalled();

    // New events should work
    Trackless.feature("new_event");
    await Trackless.flush();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

// ─── 9. Auto Screen Tracking (4 tests) ──────────────────────────────────────

describe("Auto Screen Tracking", () => {
  beforeEach(() => {
    Object.defineProperty(window, "location", {
      value: { pathname: "/" },
      writable: true,
      configurable: true,
    });
  });

  it("auto screen tracking records route-specific screen event", async () => {
    Object.defineProperty(window, "location", {
      value: { pathname: "/settings" },
      writable: true,
      configurable: true,
    });

    configure({ autoScreenTracking: true });
    await Trackless.flush();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.events.some((e: any) => e.name === "settings" && e.type === "screen")).toBe(true);
  });

  it("60-second per-route deduplication prevents rapid fire for same route", async () => {
    Object.defineProperty(window, "location", {
      value: { pathname: "/home" },
      writable: true,
      configurable: true,
    });

    configure({ autoScreenTracking: true });

    // Simulate navigating away and back to same route
    Object.defineProperty(window, "location", {
      value: { pathname: "/home" },
      writable: true,
      configurable: true,
    });
    window.dispatchEvent(new Event("popstate"));

    await Trackless.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const homeScreens = body.events.filter((e: any) => e.name === "home" && e.type === "screen");
    // Should only be 1 entry with count 1 — second was deduplicated
    expect(homeScreens.length).toBe(1);
    expect(homeScreens[0].count).toBe(1);
  });

  it("different routes have independent cooldowns", async () => {
    Object.defineProperty(window, "location", {
      value: { pathname: "/home" },
      writable: true,
      configurable: true,
    });

    configure({ autoScreenTracking: true });

    Object.defineProperty(window, "location", {
      value: { pathname: "/settings" },
      writable: true,
      configurable: true,
    });
    window.dispatchEvent(new Event("popstate"));

    await Trackless.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const names = body.events.map((e: any) => e.name);
    expect(names).toContain("home");
    expect(names).toContain("settings");
  });

  it("cooldown map resets on new configure", async () => {
    Object.defineProperty(window, "location", {
      value: { pathname: "/home" },
      writable: true,
      configurable: true,
    });

    configure({ autoScreenTracking: true });
    await Trackless.destroy();
    fetchSpy.mockClear();

    configure({ autoScreenTracking: true });
    await Trackless.flush();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.events.some((e: any) => e.name === "home" && e.type === "screen")).toBe(true);
  });
});

// ─── 10. Error Callback (1 test) ────────────────────────────────────────────

describe("Error Callback", () => {
  it("onError callback receives errors when provided", async () => {
    fetchSpy.mockRejectedValue(new Error("Server unreachable"));

    const errors: Error[] = [];
    configure({ onError: (error) => errors.push(error) });

    Trackless.feature("export_clicked");
    await Trackless.flush();

    expect(errors.length).toBe(1);
    expect(errors[0].message).toBe("Server unreachable");
  });
});

// ─── 11. Typed Events (7 tests) ─────────────────────────────────────────────

describe("Typed Events", () => {
  it("screen() records screen type event", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.screen("dashboard");
    await Trackless.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const screenEvent = body.events.find((e: any) => e.type === "screen");
    expect(screenEvent).toBeDefined();
    expect(screenEvent.name).toBe("dashboard");
  });

  it("funnel() records funnel type with step and stepIndex", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.funnel("checkout", "cart");
    Trackless.funnel("checkout", "payment");
    await Trackless.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const funnelEvents = body.events.filter((e: any) => e.type === "funnel");
    expect(funnelEvents).toHaveLength(2);
    expect(funnelEvents[0]).toMatchObject({
      type: "funnel",
      name: "checkout",
      step: "cart",
      stepIndex: 0,
    });
    expect(funnelEvents[1]).toMatchObject({
      type: "funnel",
      name: "checkout",
      step: "payment",
      stepIndex: 1,
    });
  });

  it("selection() records selection type with option", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.selection("theme", "dark");
    await Trackless.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const selEvent = body.events.find((e: any) => e.type === "selection");
    expect(selEvent).toMatchObject({ type: "selection", name: "theme", option: "dark" });
  });

  it("performance() records performance type with duration", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.performance("api_call", 150);
    await Trackless.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const perfEvent = body.events.find((e: any) => e.type === "performance");
    expect(perfEvent).toBeDefined();
    expect(perfEvent.name).toBe("api_call");
    expect(perfEvent.durations).toEqual([150]);
  });

  it("performance() rejects negative durations", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.performance("metric", -10);
    await Trackless.flush();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("error() records error type with severity and code", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.error("crash", "fatal", "E001");
    await Trackless.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const errEvent = body.events.find((e: any) => e.type === "error");
    expect(errEvent).toMatchObject({
      type: "error",
      name: "crash",
      severity: "fatal",
      code: "E001",
    });
  });

  it("event() records generic event with sanitized properties", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.event("purchase", { category: "electronics", brand: "acme" });
    await Trackless.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const genericEvent = body.events.find((e: any) => e.type === "event");
    expect(genericEvent).toBeDefined();
    expect(genericEvent.name).toBe("purchase");
    expect(genericEvent.properties).toEqual({ category: "electronics", brand: "acme" });
  });
});

// ─── 12. Session Management (4 tests) ───────────────────────────────────────

describe("Session Management", () => {
  it("configure() starts a session automatically", async () => {
    configure();
    await Trackless.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const sessionStart = body.events.find((e: any) => e.type === "session" && e.name === "start");
    expect(sessionStart).toBeDefined();
  });

  it("SessionManager tracks duration and depth", () => {
    const session = new SessionManager();
    session.start();
    session.recordActivity();
    session.recordActivity();
    session.recordActivity();

    vi.advanceTimersByTime(5000);
    const result = session.end();

    expect(result).not.toBeNull();
    expect(result!.depth).toBe(3);
    expect(result!.duration).toBe(5);
    session.destroy();
  });

  it("SessionManager 30-min inactivity timeout fires callback", async () => {
    const session = new SessionManager();
    const callback = vi.fn();
    session.onTimeout = callback;

    session.start();
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);

    expect(callback).toHaveBeenCalledTimes(1);
    session.destroy();
  });

  it("SessionManager activity resets the inactivity timer", async () => {
    const session = new SessionManager();
    const callback = vi.fn();
    session.onTimeout = callback;

    session.start();
    // Advance 29 minutes
    await vi.advanceTimersByTimeAsync(29 * 60 * 1000);
    session.recordActivity(); // reset timer

    // Advance another 29 minutes (still within 30 min of last activity)
    await vi.advanceTimersByTimeAsync(29 * 60 * 1000);
    expect(callback).not.toHaveBeenCalled();

    // Advance past the 30 min mark from last activity
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    expect(callback).toHaveBeenCalledTimes(1);
    session.destroy();
  });
});

// ─── 13. Funnel Tracking (3 tests) ──────────────────────────────────────────

describe("Funnel Tracking", () => {
  it("FunnelTracker assigns sequential stepIndex", () => {
    const tracker = new FunnelTracker();
    expect(tracker.step("checkout", "cart")).toBe(0);
    expect(tracker.step("checkout", "payment")).toBe(1);
    expect(tracker.step("checkout", "confirm")).toBe(2);
  });

  it("FunnelTracker deduplicates repeated steps", () => {
    const tracker = new FunnelTracker();
    expect(tracker.step("checkout", "cart")).toBe(0);
    expect(tracker.step("checkout", "cart")).toBeNull();
  });

  it("FunnelTracker tracks independent funnels", () => {
    const tracker = new FunnelTracker();
    expect(tracker.step("checkout", "cart")).toBe(0);
    expect(tracker.step("onboarding", "welcome")).toBe(0);
    expect(tracker.step("checkout", "payment")).toBe(1);
    expect(tracker.step("onboarding", "profile")).toBe(1);
  });
});

// ─── 14. PII Guard (5 tests) ────────────────────────────────────────────────

describe("PII Guard", () => {
  it("strips blocked keys", () => {
    const result = sanitizeProperties({
      email: "test@test.com",
      category: "electronics",
    });
    expect(result).toEqual({ category: "electronics" });
  });

  it("strips values matching PII patterns", () => {
    const result = sanitizeProperties({
      contact: "user@example.com",
      color: "blue",
    });
    expect(result).toEqual({ color: "blue" });
  });

  it("enforces max 10 properties", () => {
    const props: Record<string, string> = {};
    for (let i = 0; i < 15; i++) {
      props[`key_${i}`] = `value_${i}`;
    }
    const result = sanitizeProperties(props);
    expect(Object.keys(result!).length).toBe(10);
  });

  it("truncates long keys and values", () => {
    const result = sanitizeProperties({
      ["a".repeat(100)]: "b".repeat(300),
    });
    const keys = Object.keys(result!);
    expect(keys[0].length).toBe(50);
    expect(result![keys[0]].length).toBe(200);
  });

  it("returns undefined when all properties are stripped", () => {
    const result = sanitizeProperties({
      email: "test@test.com",
      phone: "555-123-4567",
    });
    expect(result).toBeUndefined();
  });
});

// ─── 15. Payload Structure (3 tests) ────────────────────────────────────────

describe("Payload Structure", () => {
  it("payload includes date, environment, context, and events", async () => {
    configure({ environment: "sandbox" });
    Trackless.feature("test_feature");
    await Trackless.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.environment).toBe("sandbox");
    expect(body.context).toBeDefined();
    expect(body.context.platform).toBe("web");
    expect(Array.isArray(body.events)).toBe(true);
  });

  it("API key sent as X-Api-Key header", async () => {
    configure();
    Trackless.feature("export_clicked");
    await Trackless.flush();

    const headers = fetchSpy.mock.calls[0][1].headers;
    expect(headers["X-Api-Key"]).toBe(TEST_API_KEY);
  });

  it("EventBuffer splits large payloads at 100 events", () => {
    const buffer = new EventBuffer();
    for (let i = 0; i < 150; i++) {
      buffer.add({ type: "feature", name: `feature_${i}` });
    }

    const payloads = buffer.drain("production", { platform: "web" });
    expect(payloads.length).toBe(2);
    expect(payloads[0].events.length).toBe(100);
    expect(payloads[1].events.length).toBe(50);
  });
});
