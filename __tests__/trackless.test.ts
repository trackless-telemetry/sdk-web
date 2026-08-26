/**
 * Trackless Web SDK — Comprehensive Test Suite
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Trackless, Severity } from "../src/Trackless.js";
import type { TracklessConfig } from "../src/types.js";
import { EventBuffer } from "../src/eventBuffer.js";
import { CircuitBreaker } from "../src/circuitBreaker.js";
import { FunnelTracker } from "../src/funnel.js";
import { FeatureReachTracker } from "../src/featureReach.js";
import { ErrorReachTracker } from "../src/errorReach.js";
import { SessionManager } from "../src/session.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TEST_API_KEY = "tl_0123456789abcdef0123456789abcdef";
const TEST_ENDPOINT = "https://api.test.com";

function configure(overrides: Partial<TracklessConfig> = {}): void {
  Trackless.configure({
    apiKey: TEST_API_KEY,
    endpoint: TEST_ENDPOINT,
    flushIntervalSeconds: 999_999, // large value to effectively disable periodic flush in tests
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
    buffer.add({ type: "view", name: "export" });

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

  it("performance events with different thresholds create separate buffer entries", () => {
    const buffer = new EventBuffer();
    buffer.add({ type: "performance", name: "api_call", duration: 100, threshold: 2 });
    buffer.add({ type: "performance", name: "api_call", duration: 200, threshold: 5 });
    buffer.add({ type: "performance", name: "api_call", duration: 150, threshold: 2 });

    expect(buffer.totalSize).toBe(2);
    const payloads = buffer.drain("production", { platform: "web" });
    const events = payloads[0].events;
    const t2 = events.find((e) => e.threshold === 2);
    const t5 = events.find((e) => e.threshold === 5);
    expect(t2?.durations).toEqual([100, 150]);
    expect(t5?.durations).toEqual([200]);
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
    configure({ flushIntervalSeconds: 1 });
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
  it("empty event name is silently ignored", () => {
    configure();
    expect(() => Trackless.feature("")).not.toThrow();
  });

  it("only-special-chars event name is silently ignored", () => {
    configure();
    // All chars are invalid, normalization produces empty string → dropped
    expect(() => Trackless.feature("!!!")).not.toThrow();
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

  it("spaces and special chars in name are normalized to underscores", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.feature("My Feature!");
    await Trackless.flush();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.events.some((e: any) => e.name === "my_feature")).toBe(true);
  });

  it("long names are truncated to 100 characters", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.feature("x".repeat(101));
    await Trackless.flush();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const event = body.events.find((e: any) => e.type === "feature");
    expect(event.name).toBe("x".repeat(100));
  });

  it("consecutive dots are collapsed", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.feature("foo..bar");
    await Trackless.flush();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.events.some((e: any) => e.name === "foo.bar")).toBe(true);
  });
});

// ─── 3b. Field Normalization (detail, code) ──────────────────────────────────

describe("Field Normalization", () => {
  it("detail with spaces and uppercase is normalized", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.feature("export", "Product Details Page");
    await Trackless.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const event = body.events.find((e: any) => e.type === "feature");
    expect(event.detail).toBe("product_details_page");
  });

  it("detail that normalizes to empty is omitted", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.view("home", "!!!");
    await Trackless.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const event = body.events.find((e: any) => e.type === "view");
    expect(event.detail).toBeUndefined();
  });

  it("detail with abuse pattern is omitted", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    // 18 hex-only chars triggers the entirely-hex-and-long abuse check
    Trackless.view("home", "abcdefabcdefabcdef");
    await Trackless.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const event = body.events.find((e: any) => e.type === "view");
    expect(event.detail).toBeUndefined();
  });

  it("error code with spaces is normalized", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.error("crash", "error", "Network Error");
    await Trackless.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const event = body.events.find((e: any) => e.type === "error");
    expect(event.code).toBe("network_error");
  });

  it("error code that normalizes to empty is omitted", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.error("crash", "error", "###");
    await Trackless.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const event = body.events.find((e: any) => e.type === "error");
    expect(event.code).toBeUndefined();
  });

  it("leading/trailing special chars are trimmed from detail", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.feature("export", "...foo...");
    await Trackless.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const event = body.events.find((e: any) => e.type === "feature");
    expect(event.detail).toBe("foo");
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
    expect(() => Trackless.view("valid")).not.toThrow();
    expect(() => Trackless.view("product", "shoes")).not.toThrow();
    expect(() => Trackless.performance("metric", 100)).not.toThrow();
    expect(() => Trackless.error("crash")).not.toThrow();
    expect(() => Trackless.funnel("checkout", 0, "step1")).not.toThrow();
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

  it("auto screen tracking records route-specific view event", async () => {
    Object.defineProperty(window, "location", {
      value: { pathname: "/settings" },
      writable: true,
      configurable: true,
    });

    configure({ autoScreenTracking: true });
    await Trackless.flush();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.events.some((e: any) => e.name === "settings" && e.type === "view")).toBe(true);
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
    const homeViews = body.events.filter((e: any) => e.name === "home" && e.type === "view");
    // Should only be 1 entry with count 1 — second was deduplicated
    expect(homeViews.length).toBe(1);
    expect(homeViews[0].count).toBe(1);
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
    expect(body.events.some((e: any) => e.name === "home" && e.type === "view")).toBe(true);
  });

  it("hash fragment is recorded as view detail", async () => {
    Object.defineProperty(window, "location", {
      value: { pathname: "/", hash: "#pricing" },
      writable: true,
      configurable: true,
    });

    configure({ autoScreenTracking: true });
    await Trackless.flush();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const homeView = body.events.find((e: any) => e.name === "home" && e.type === "view");
    expect(homeView).toBeDefined();
    expect(homeView.detail).toBe("pricing");
  });

  it("different hash fragments on same path have independent cooldowns", async () => {
    Object.defineProperty(window, "location", {
      value: { pathname: "/", hash: "#features" },
      writable: true,
      configurable: true,
    });

    configure({ autoScreenTracking: true });

    // Navigate to different hash on same page
    Object.defineProperty(window, "location", {
      value: { pathname: "/", hash: "#pricing" },
      writable: true,
      configurable: true,
    });
    window.dispatchEvent(new Event("hashchange"));

    await Trackless.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const viewEvents = body.events.filter((e: any) => e.type === "view");
    const details = viewEvents.map((e: any) => e.detail);
    expect(details).toContain("features");
    expect(details).toContain("pricing");
  });

  it("same hash fragment is deduplicated within cooldown window", async () => {
    Object.defineProperty(window, "location", {
      value: { pathname: "/", hash: "#features" },
      writable: true,
      configurable: true,
    });

    configure({ autoScreenTracking: true });

    // Trigger hashchange to same hash
    window.dispatchEvent(new Event("hashchange"));

    await Trackless.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const featureViews = body.events.filter(
      (e: any) => e.type === "view" && e.detail === "features",
    );
    expect(featureViews.length).toBe(1);
    expect(featureViews[0].count).toBe(1);
  });

  it("no hash produces view without detail", async () => {
    Object.defineProperty(window, "location", {
      value: { pathname: "/about", hash: "" },
      writable: true,
      configurable: true,
    });

    configure({ autoScreenTracking: true });
    await Trackless.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const aboutView = body.events.find((e: any) => e.name === "about" && e.type === "view");
    expect(aboutView).toBeDefined();
    expect(aboutView.detail).toBeUndefined();
  });
});

// ─── 9b. Auto Screen Tracking — Dynamic Segment Stripping (7 tests) ────────

describe("Auto Screen Tracking — Dynamic Segment Stripping", () => {
  beforeEach(() => {
    Object.defineProperty(window, "location", {
      value: { pathname: "/" },
      writable: true,
      configurable: true,
    });
  });

  it("UUID in path is replaced with -id-", async () => {
    Object.defineProperty(window, "location", {
      value: { pathname: "/apps/e2ebbbc5-f5e9-42eb-8913-4ef078b9b4a6/sessions" },
      writable: true,
      configurable: true,
    });

    configure({ autoScreenTracking: true });
    await Trackless.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.events.some((e: any) => e.name === "apps_-id-_sessions" && e.type === "view")).toBe(
      true,
    );
  });

  it("long numeric ID is replaced with -id-", async () => {
    Object.defineProperty(window, "location", {
      value: { pathname: "/users/12345678/profile" },
      writable: true,
      configurable: true,
    });

    configure({ autoScreenTracking: true });
    await Trackless.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.events.some((e: any) => e.name === "users_-id-_profile" && e.type === "view")).toBe(
      true,
    );
  });

  it("long hex string (MongoDB ObjectID) is replaced with -id-", async () => {
    Object.defineProperty(window, "location", {
      value: { pathname: "/orders/5f3d8a2b1c4e7890abcd1234/details" },
      writable: true,
      configurable: true,
    });

    configure({ autoScreenTracking: true });
    await Trackless.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(
      body.events.some((e: any) => e.name === "orders_-id-_details" && e.type === "view"),
    ).toBe(true);
  });

  it("short numbers are preserved", async () => {
    Object.defineProperty(window, "location", {
      value: { pathname: "/products/42/reviews" },
      writable: true,
      configurable: true,
    });

    configure({ autoScreenTracking: true });
    await Trackless.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(
      body.events.some((e: any) => e.name === "products_42_reviews" && e.type === "view"),
    ).toBe(true);
  });

  it("multiple dynamic segments are all replaced", async () => {
    Object.defineProperty(window, "location", {
      value: { pathname: "/org/e2ebbbc5-f5e9-42eb-8913-4ef078b9b4a6/users/98765432" },
      writable: true,
      configurable: true,
    });

    configure({ autoScreenTracking: true });
    await Trackless.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(
      body.events.some((e: any) => e.name === "org_-id-_users_-id-" && e.type === "view"),
    ).toBe(true);
  });

  it("paths without dynamic segments are unchanged", async () => {
    Object.defineProperty(window, "location", {
      value: { pathname: "/settings" },
      writable: true,
      configurable: true,
    });

    configure({ autoScreenTracking: true });
    await Trackless.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.events.some((e: any) => e.name === "settings" && e.type === "view")).toBe(true);
  });

  it("root path produces 'home'", async () => {
    Object.defineProperty(window, "location", {
      value: { pathname: "/" },
      writable: true,
      configurable: true,
    });

    configure({ autoScreenTracking: true });
    await Trackless.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.events.some((e: any) => e.name === "home" && e.type === "view")).toBe(true);
  });
});

// ─── 10. Error Callback (2 tests) ────────────────────────────────────────────

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

  it("onError receives 4xx rejection errors", async () => {
    fetchSpy.mockResolvedValue({
      status: 400,
      json: () => Promise.resolve({}),
    });

    const errors: Error[] = [];
    configure({ onError: (error) => errors.push(error) });

    Trackless.feature("export_clicked");
    await Trackless.flush();

    expect(errors.length).toBe(1);
    expect(errors[0].message).toContain("400");
  });
});

// ─── 10b. Debug Logging (3 tests) ───────────────────────────────────────────

describe("Debug Logging", () => {
  it("debugLogging: true produces console output", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    configure({ debugLogging: true });
    Trackless.feature("export_clicked");

    const tracklessLogs = logSpy.mock.calls.filter((c) => String(c[0]).includes("[Trackless]"));
    expect(tracklessLogs.length).toBeGreaterThanOrEqual(2); // configure + feature

    logSpy.mockRestore();
  });

  it("debugLogging: false (default) produces no console.log output", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    configure();
    Trackless.feature("export_clicked");

    const tracklessLogs = logSpy.mock.calls.filter((c) => String(c[0]).includes("[Trackless]"));
    expect(tracklessLogs.length).toBe(0);

    logSpy.mockRestore();
  });

  it("warnings log by default (without debugLogging)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    configure();
    // Name that normalizes to empty → triggers warning
    Trackless.feature("!!!");

    const tracklessWarns = warnSpy.mock.calls.filter((c) => String(c[0]).includes("[Trackless]"));
    expect(tracklessWarns.length).toBeGreaterThanOrEqual(1);

    warnSpy.mockRestore();
  });

  it("suppressWarnings: true suppresses warning output", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    configure({ suppressWarnings: true });
    // Name that normalizes to empty → would trigger warning but suppressed
    Trackless.feature("!!!");

    const tracklessWarns = warnSpy.mock.calls.filter((c) => String(c[0]).includes("[Trackless]"));
    expect(tracklessWarns.length).toBe(0);

    warnSpy.mockRestore();
  });
});

// ─── 11. Typed Events (7 tests) ─────────────────────────────────────────────

describe("Typed Events", () => {
  it("view() records view type event", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.view("dashboard");
    await Trackless.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const viewEvent = body.events.find((e: any) => e.type === "view");
    expect(viewEvent).toBeDefined();
    expect(viewEvent.name).toBe("dashboard");
  });

  it("view() with detail includes detail in event", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.view("product", "shoes");
    await Trackless.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const viewEvent = body.events.find((e: any) => e.type === "view");
    expect(viewEvent).toBeDefined();
    expect(viewEvent.name).toBe("product");
    expect(viewEvent.detail).toBe("shoes");
  });

  it("feature() with detail includes detail in event", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.feature("sort_changed", "price_desc");
    await Trackless.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const featureEvent = body.events.find((e: any) => e.type === "feature");
    expect(featureEvent).toBeDefined();
    expect(featureEvent.name).toBe("sort_changed");
    expect(featureEvent.detail).toBe("price_desc");
  });

  it("feature() without detail does not include detail field", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.feature("export_clicked");
    await Trackless.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const featureEvent = body.events.find((e: any) => e.type === "feature");
    expect(featureEvent).toBeDefined();
    expect(featureEvent.name).toBe("export_clicked");
    expect(featureEvent.detail).toBeUndefined();
  });

  it("funnel() records funnel type with step and stepIndex", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.funnel("checkout", 0, "cart");
    Trackless.funnel("checkout", 1, "payment");
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

  it("performance() includes threshold when provided", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.performance("api_call", 1.5, 2.0);
    await Trackless.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const perfEvent = body.events.find((e: any) => e.type === "performance");
    expect(perfEvent).toBeDefined();
    expect(perfEvent.name).toBe("api_call");
    expect(perfEvent.threshold).toBe(2.0);
    expect(perfEvent.durations).toEqual([1.5]);
  });

  it("performance() rejects invalid thresholds", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.performance("metric", 1.0, -1);
    Trackless.performance("metric", 1.0, 0);
    await Trackless.flush();
    expect(fetchSpy).not.toHaveBeenCalled();
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
      code: "e001",
    });
  });
});

// ─── 11b. Detail Rollup Keys (3 tests) ──────────────────────────────────────

describe("Detail Rollup Keys", () => {
  it("view events with different details create separate rollup entries", () => {
    const buffer = new EventBuffer();
    buffer.add({ type: "view", name: "product" });
    buffer.add({ type: "view", name: "product", detail: "shoes" });
    buffer.add({ type: "view", name: "product", detail: "hats" });

    expect(buffer.totalSize).toBe(3);
  });

  it("feature events with same detail are rolled up together", () => {
    const buffer = new EventBuffer();
    buffer.add({ type: "feature", name: "sort_changed", detail: "price_desc" });
    buffer.add({ type: "feature", name: "sort_changed", detail: "price_desc" });

    expect(buffer.totalSize).toBe(1);
    const payloads = buffer.drain("production", { platform: "web" });
    expect(payloads[0].events[0].count).toBe(2);
    expect(payloads[0].events[0].detail).toBe("price_desc");
  });

  it("feature events with different details create separate entries", () => {
    const buffer = new EventBuffer();
    buffer.add({ type: "feature", name: "sort_changed", detail: "price_desc" });
    buffer.add({ type: "feature", name: "sort_changed", detail: "name_asc" });

    expect(buffer.totalSize).toBe(2);
    const payloads = buffer.drain("production", { platform: "web" });
    const allEvents = payloads.flatMap((p) => p.events);
    expect(allEvents.find((e) => e.detail === "price_desc")).toBeDefined();
    expect(allEvents.find((e) => e.detail === "name_asc")).toBeDefined();
  });
});

// ─── 11c. Detail Validation (3 tests) ───────────────────────────────────────

describe("Detail Validation", () => {
  it("view() with empty string detail records event without detail", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.view("product", "");
    await Trackless.flush();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const event = body.events.find((e: any) => e.type === "view");
    expect(event.name).toBe("product");
    expect(event.detail).toBeUndefined();
  });

  it("feature() with empty string detail records event without detail", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.feature("sort_changed", "");
    await Trackless.flush();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const event = body.events.find((e: any) => e.type === "feature");
    expect(event.name).toBe("sort_changed");
    expect(event.detail).toBeUndefined();
  });

  it("view() and feature() with undefined detail work normally", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.view("home");
    Trackless.feature("export_clicked");
    await Trackless.flush();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.events.some((e: any) => e.type === "view" && e.name === "home")).toBe(true);
    expect(body.events.some((e: any) => e.type === "feature" && e.name === "export_clicked")).toBe(
      true,
    );
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

  it("SessionManager start returns false if session already active", () => {
    const session = new SessionManager();
    expect(session.start()).toBe(true);
    expect(session.start()).toBe(false); // already active
    session.destroy();
  });
});

// ─── 13. Funnel Tracking (3 tests) ──────────────────────────────────────────

describe("Funnel Tracking", () => {
  it("FunnelTracker accepts explicit step indices", () => {
    const tracker = new FunnelTracker();
    expect(tracker.step("checkout", 0)).toBe(true);
    expect(tracker.step("checkout", 1)).toBe(true);
    expect(tracker.step("checkout", 2)).toBe(true);
  });

  it("FunnelTracker deduplicates repeated step indices", () => {
    const tracker = new FunnelTracker();
    expect(tracker.step("checkout", 0)).toBe(true);
    expect(tracker.step("checkout", 0)).toBe(false);
  });

  it("FunnelTracker tracks independent funnels", () => {
    const tracker = new FunnelTracker();
    expect(tracker.step("checkout", 0)).toBe(true);
    expect(tracker.step("onboarding", 0)).toBe(true);
    expect(tracker.step("checkout", 1)).toBe(true);
    expect(tracker.step("onboarding", 1)).toBe(true);
  });
});

// ─── 14. Payload Structure (3 tests) ─────────────────────────────────────────

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

// ─── 15. PII Stripping (9 tests) ─────────────────────────────────────────────

describe("PII Stripping", () => {
  it("strips email addresses from detail fields", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.feature("contact_form", "submitted by user@example.com");
    await Trackless.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const event = body.events.find((e: any) => e.type === "feature");
    // PII stripped then normalized: "submitted by [REDACTED]" → "submitted_by_redacted"
    expect(event.detail).not.toContain("@");
    expect(event.detail).toBe("submitted_by_redacted");
  });

  it("strips SSN patterns (dashed) from detail fields", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.view("profile", "ssn 123-45-6789");
    await Trackless.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const event = body.events.find((e: any) => e.type === "view");
    // PII stripped then normalized: "ssn [REDACTED]" → "ssn_redacted"
    expect(event.detail).not.toMatch(/\d{3}-\d{2}-\d{4}/);
    expect(event.detail).toBe("ssn_redacted");
  });

  it("strips SSN patterns (9 consecutive digits) from detail fields", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.feature("form_submit", "id 123456789 entered");
    await Trackless.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const event = body.events.find((e: any) => e.type === "feature");
    // PII stripped then normalized: "id [REDACTED] entered" → "id_redacted_entered"
    expect(event.detail).not.toMatch(/\d{9}/);
    expect(event.detail).toBe("id_redacted_entered");
  });

  it("strips phone numbers from detail fields", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.feature("call_support", "called +1 (555) 123-4567");
    await Trackless.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const event = body.events.find((e: any) => e.type === "feature");
    // PII stripped then normalized: "called [REDACTED]" → "called_redacted"
    expect(event.detail).not.toMatch(/555/);
    expect(event.detail).toBe("called_redacted");
  });

  it("strips phone numbers without formatting", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.feature("dial", "number 5551234567");
    await Trackless.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const event = body.events.find((e: any) => e.type === "feature");
    // PII stripped then normalized: "number [REDACTED]" → "number_redacted"
    expect(event.detail).not.toMatch(/555/);
    expect(event.detail).toBe("number_redacted");
  });

  it("strips PII from error code field", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.error("auth_failed", "error", "user@test.com");
    await Trackless.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const event = body.events.find((e: any) => e.type === "error");
    // PII stripped then normalized: "[REDACTED]" → "redacted"
    expect(event.code).not.toContain("@");
    expect(event.code).toBe("redacted");
  });

  it("strips multiple PII patterns from a single string", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.feature("contact", "email: a@b.com phone: 555-123-4567");
    await Trackless.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const event = body.events.find((e: any) => e.type === "feature");
    expect(event.detail).not.toContain("@");
    expect(event.detail).not.toContain("555");
  });

  it("leaves non-PII strings unchanged", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.feature("theme_changed", "dark_mode");
    await Trackless.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const event = body.events.find((e: any) => e.type === "feature");
    expect(event.detail).toBe("dark_mode");
  });

  it("strips email from event names via normalizeField", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    // PII stripped then normalized: "user@example.com" → "[REDACTED]" → "redacted"
    Trackless.feature("user@example.com");
    await Trackless.flush();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const event = body.events.find((e: any) => e.type === "feature");
    expect(event.name).toBe("redacted");
  });
});

// ─── 16. SDK Version (1 test) ─────────────────────────────────────────────────

describe("SDK Version", () => {
  it("context includes sdkVersion matching web/X.Y.Z pattern", async () => {
    configure();
    Trackless.feature("test_feature");
    await Trackless.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.context.sdkVersion).toMatch(/^web\/\d+\.\d+\.\d+$/);
  });
});

// ─── 17. Payload Size Limit (3 tests) ────────────────────────────────────────

const MAX_REQUEST_BODY_SIZE_BYTES = 50 * 1024;

describe("Payload Size Limit", () => {
  it("splits payloads that exceed the 50KB body limit into multiple requests", async () => {
    configure();
    await Trackless.flush(); // flush session start
    fetchSpy.mockClear();

    // Four performance events, each ~21KB serialized (2600 durations × 8 bytes).
    // Together they exceed 50KB but each half fits.
    for (const name of ["metric_a", "metric_b", "metric_c", "metric_d"]) {
      for (let i = 0; i < 2600; i++) {
        Trackless.performance(name, 123.456);
      }
    }
    await Trackless.flush();

    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2);

    const allEvents: any[] = [];
    for (const call of fetchSpy.mock.calls) {
      const bodyStr = call[1].body as string;
      // Every request body fits the server limit
      expect(new TextEncoder().encode(bodyStr).length).toBeLessThanOrEqual(
        MAX_REQUEST_BODY_SIZE_BYTES,
      );
      // Wire format is unchanged
      const body = JSON.parse(bodyStr);
      expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(body.environment).toBeDefined();
      expect(body.context.platform).toBe("web");
      allEvents.push(...body.events);
    }

    // No events lost across the split
    const perfEvents = allEvents.filter((e) => e.type === "performance");
    expect(perfEvents.map((e) => e.name).sort()).toEqual([
      "metric_a",
      "metric_b",
      "metric_c",
      "metric_d",
    ]);
    for (const event of perfEvents) {
      expect(event.durations).toHaveLength(2600);
    }
  });

  it("payloads under the limit are sent as a single request", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.feature("small_feature");
    Trackless.view("small_view");
    await Trackless.flush();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("drops a single event whose payload still exceeds the limit, keeps the rest", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // One performance event ~64KB serialized — cannot fit even alone
    for (let i = 0; i < 8000; i++) {
      Trackless.performance("huge_metric", 123.456);
    }
    Trackless.feature("small_feature");
    await Trackless.flush();

    const allEvents = fetchSpy.mock.calls.flatMap((call: any[]) => JSON.parse(call[1].body).events);
    expect(allEvents.some((e: any) => e.name === "huge_metric")).toBe(false);
    expect(allEvents.some((e: any) => e.name === "small_feature")).toBe(true);
    for (const call of fetchSpy.mock.calls) {
      expect(new TextEncoder().encode(call[1].body as string).length).toBeLessThanOrEqual(
        MAX_REQUEST_BODY_SIZE_BYTES,
      );
    }

    const dropWarns = warnSpy.mock.calls.filter(
      (c) => String(c[0]).includes("[Trackless]") && String(c[0]).includes("body size limit"),
    );
    expect(dropWarns.length).toBe(1);
    warnSpy.mockRestore();
  });
});

// ─── 18. Buffer-Full Warning (3 tests) ───────────────────────────────────────

describe("Buffer-Full Warning", () => {
  /** Open the circuit breaker so the buffer stops draining and can fill up. */
  async function openCircuitBreaker(): Promise<void> {
    Trackless.feature("seed");
    await Trackless.flush(); // drains, fails, opens circuit breaker
  }

  it("warns exactly once when the buffer rejects events because it is full", async () => {
    fetchSpy.mockRejectedValue(new Error("down"));
    configure({ onError: () => {} });
    await openCircuitBreaker();

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Buffer max is 1000 unique items — overflow it with room to spare
    for (let i = 0; i < 1005; i++) {
      Trackless.feature(`item_${i}`);
    }

    const bufferWarns = warnSpy.mock.calls.filter((c) => String(c[0]).includes("buffer full"));
    expect(bufferWarns.length).toBe(1);
    warnSpy.mockRestore();
  });

  it("buffer-full warning can fire again after a new configure()", async () => {
    fetchSpy.mockRejectedValue(new Error("down"));
    configure({ onError: () => {} });
    await openCircuitBreaker();

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < 1005; i++) {
      Trackless.feature(`item_${i}`);
    }

    configure({ onError: () => {} }); // new session resets the once-per-session flag
    await openCircuitBreaker();
    for (let i = 0; i < 1005; i++) {
      Trackless.feature(`other_${i}`);
    }

    const bufferWarns = warnSpy.mock.calls.filter((c) => String(c[0]).includes("buffer full"));
    expect(bufferWarns.length).toBe(2);
    warnSpy.mockRestore();
  });

  it("buffer-full warning respects suppressWarnings", async () => {
    fetchSpy.mockRejectedValue(new Error("down"));
    configure({ suppressWarnings: true, onError: () => {} });
    await openCircuitBreaker();

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < 1005; i++) {
      Trackless.feature(`item_${i}`);
    }

    const tracklessWarns = warnSpy.mock.calls.filter((c) => String(c[0]).includes("[Trackless]"));
    expect(tracklessWarns.length).toBe(0);
    warnSpy.mockRestore();
  });
});

// ─── 19. Pre-Configure Warning (3 tests) ─────────────────────────────────────

describe("Pre-Configure Warning", () => {
  it("warns once when event methods are called while unconfigured", async () => {
    configure(); // reset suppressWarnings and the once-only flag
    await Trackless.destroy(); // back to unconfigured state
    fetchSpy.mockClear();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    Trackless.feature("too_early");
    Trackless.view("also_early");
    Trackless.error("early_error");

    const preWarns = warnSpy.mock.calls.filter((c) => String(c[0]).includes("not configured"));
    expect(preWarns.length).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("pre-configure warning respects suppressWarnings", async () => {
    configure({ suppressWarnings: true });
    await Trackless.destroy();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    Trackless.feature("too_early");

    const tracklessWarns = warnSpy.mock.calls.filter((c) => String(c[0]).includes("[Trackless]"));
    expect(tracklessWarns.length).toBe(0);
    warnSpy.mockRestore();
  });

  it("no pre-configure warning when events are dropped because enabled is false", async () => {
    configure({ enabled: false });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    Trackless.feature("ignored");

    const preWarns = warnSpy.mock.calls.filter((c) => String(c[0]).includes("not configured"));
    expect(preWarns.length).toBe(0);
    warnSpy.mockRestore();
  });
});

// ─── 20. Error Severity Validation (5 tests) ─────────────────────────────────

describe("Error Severity Validation", () => {
  it("Severity constants cover exactly the values accepted by the server", () => {
    expect(Object.values(Severity).sort()).toEqual(["debug", "error", "fatal", "info", "warning"]);
  });

  it("accepts all valid severity values unchanged", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.error("e_debug", "debug");
    Trackless.error("e_info", "info");
    Trackless.error("e_warning", "warning");
    Trackless.error("e_error", "error");
    Trackless.error("e_fatal", "fatal");
    await Trackless.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const severities = body.events
      .filter((e: any) => e.type === "error")
      .map((e: any) => e.severity)
      .sort();
    expect(severities).toEqual(["debug", "error", "fatal", "info", "warning"]);
  });

  it("default severity is 'error' when omitted", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.error("crash");
    await Trackless.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const errEvent = body.events.find((e: any) => e.type === "error");
    expect(errEvent.severity).toBe("error");
  });

  it("invalid severity falls back to 'error' with a warning", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    Trackless.error("crash", "catastrophic" as any);
    await Trackless.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const errEvent = body.events.find((e: any) => e.type === "error");
    expect(errEvent.severity).toBe("error");

    const sevWarns = warnSpy.mock.calls.filter((c) => String(c[0]).includes("severity"));
    expect(sevWarns.length).toBe(1);
    warnSpy.mockRestore();
  });

  it("severity fallback warning respects suppressWarnings", async () => {
    configure({ suppressWarnings: true });
    await Trackless.flush();
    fetchSpy.mockClear();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    Trackless.error("crash", "bogus" as any);
    await Trackless.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.events.find((e: any) => e.type === "error").severity).toBe("error");

    const tracklessWarns = warnSpy.mock.calls.filter((c) => String(c[0]).includes("[Trackless]"));
    expect(tracklessWarns.length).toBe(0);
    warnSpy.mockRestore();
  });
});

// ─── 21. Feature Reach — FeatureReachTracker (3 tests) ───────────────────────

describe("FeatureReachTracker", () => {
  it("marks the first use true and repeats false", () => {
    const tracker = new FeatureReachTracker();
    expect(tracker.firstUse("export_clicked")).toBe(true);
    expect(tracker.firstUse("export_clicked")).toBe(false);
    expect(tracker.firstUse("export_clicked")).toBe(false);
  });

  it("dedups distinct names independently", () => {
    const tracker = new FeatureReachTracker();
    expect(tracker.firstUse("export")).toBe(true);
    expect(tracker.firstUse("import")).toBe(true);
    expect(tracker.firstUse("export")).toBe(false);
    expect(tracker.firstUse("import")).toBe(false);
  });

  it("clear() resets so the next use counts as a first use again", () => {
    const tracker = new FeatureReachTracker();
    expect(tracker.firstUse("export")).toBe(true);
    tracker.clear();
    expect(tracker.firstUse("export")).toBe(true);
  });
});

// ─── 22. Feature Reach — buffer rollup of firstUses (4 tests) ─────────────────

describe("Feature Reach — buffer rollup", () => {
  it("addCountable sums firstUses across adds (cross-session-boundary rollup)", () => {
    const buffer = new EventBuffer();
    buffer.add({ type: "feature", name: "x", firstUses: 1 }); // session 1 first use
    buffer.add({ type: "feature", name: "x", firstUses: 1 }); // session 2 first use, same key, pre-flush
    buffer.add({ type: "feature", name: "x" }); // repeat, no marker

    const payloads = buffer.drain("production", { platform: "web" });
    const event = payloads[0].events.find((e) => e.name === "x");
    expect(event?.count).toBe(3);
    expect(event?.firstUses).toBe(2);
  });

  it("a different-detail entry carries no firstUses (never 0)", () => {
    const buffer = new EventBuffer();
    buffer.add({ type: "feature", name: "x", detail: "a", firstUses: 1 }); // first use → variant a
    buffer.add({ type: "feature", name: "x", detail: "b" }); // later use, different detail → separate key

    const payloads = buffer.drain("production", { platform: "web" });
    const events = payloads[0].events;
    const a = events.find((e) => e.detail === "a");
    const b = events.find((e) => e.detail === "b");
    expect(a?.firstUses).toBe(1);
    expect(b?.firstUses).toBeUndefined();
    expect("firstUses" in (b as object)).toBe(false);
  });

  it("a repeat-only entry carries no firstUses", () => {
    const buffer = new EventBuffer();
    // Name already seen earlier this session and flushed — later uses arrive unmarked.
    buffer.add({ type: "feature", name: "y" });
    buffer.add({ type: "feature", name: "y" });

    const payloads = buffer.drain("production", { platform: "web" });
    const event = payloads[0].events.find((e) => e.name === "y");
    expect(event?.count).toBe(2);
    expect(event?.firstUses).toBeUndefined();
  });

  it("drain drops a non-positive firstUses so it never reaches the wire", () => {
    const buffer = new EventBuffer();
    buffer.add({ type: "feature", name: "z", firstUses: 0 });

    const payloads = buffer.drain("production", { platform: "web" });
    const event = payloads[0].events.find((e) => e.name === "z");
    expect(event?.firstUses).toBeUndefined();
    expect("firstUses" in (event as object)).toBe(false);
  });
});

// ─── 23. Feature Reach — feature() first-use marking (7 tests) ────────────────

describe("Feature Reach — feature() first-use marking", () => {
  function featureEvent(callIndex: number, name = "export_clicked"): any {
    const body = JSON.parse(fetchSpy.mock.calls[callIndex][1].body);
    return body.events.find((e: any) => e.type === "feature" && e.name === name);
  }

  it("first feature() carries firstUses:1; a later repeat (separate flush) carries none", async () => {
    configure();
    await Trackless.flush(); // drain session:start
    fetchSpy.mockClear();

    Trackless.feature("export_clicked"); // first use
    await Trackless.flush();
    expect(featureEvent(0).firstUses).toBe(1);
    fetchSpy.mockClear();

    Trackless.feature("export_clicked"); // repeat, same session
    await Trackless.flush();
    expect(featureEvent(0).firstUses).toBeUndefined();
  });

  it("repeats within a single flush roll up to count>1 with firstUses:1", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.feature("save");
    Trackless.feature("save");
    Trackless.feature("save");
    await Trackless.flush();

    const event = featureEvent(0, "save");
    expect(event.count).toBe(3);
    expect(event.firstUses).toBe(1);
  });

  it("distinct feature names dedup independently", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.feature("alpha");
    Trackless.feature("beta");
    Trackless.feature("alpha"); // repeat
    Trackless.feature("beta"); // repeat
    await Trackless.flush();

    const events = JSON.parse(fetchSpy.mock.calls[0][1].body).events;
    const alpha = events.find((e: any) => e.name === "alpha");
    const beta = events.find((e: any) => e.name === "beta");
    expect(alpha.count).toBe(2);
    expect(alpha.firstUses).toBe(1);
    expect(beta.count).toBe(2);
    expect(beta.firstUses).toBe(1);
  });

  it("dedup runs on the normalized name (natural-string variants share one first use)", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.feature("Export Clicked"); // normalizes to export_clicked → first use
    Trackless.feature("export_clicked"); // same normalized name → repeat
    await Trackless.flush();

    const features = JSON.parse(fetchSpy.mock.calls[0][1].body).events.filter(
      (e: any) => e.type === "feature",
    );
    expect(features).toHaveLength(1);
    expect(features[0].name).toBe("export_clicked");
    expect(features[0].count).toBe(2);
    expect(features[0].firstUses).toBe(1);
  });

  it("reach dedup is by name only, not name+detail", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.feature("share", "twitter"); // first use of "share" → marks the twitter variant
    Trackless.feature("share", "email"); // same name, different detail → no new first use
    await Trackless.flush();

    const events = JSON.parse(fetchSpy.mock.calls[0][1].body).events.filter(
      (e: any) => e.type === "feature" && e.name === "share",
    );
    const twitter = events.find((e: any) => e.detail === "twitter");
    const email = events.find((e: any) => e.detail === "email");
    expect(twitter.firstUses).toBe(1);
    expect(email.firstUses).toBeUndefined();
    // Reach summed across variants is exactly 1 for this session.
    const totalFirstUses = events.reduce((s: number, e: any) => s + (e.firstUses ?? 0), 0);
    expect(totalFirstUses).toBe(1);
  });

  it("first-use set survives a mid-session flush but re-marks after session end", async () => {
    configure();
    await Trackless.flush(); // drain session:start
    fetchSpy.mockClear();

    // Session 1: first use → firstUses:1
    Trackless.feature("export_clicked");
    await Trackless.flush();
    expect(featureEvent(0).firstUses).toBe(1);
    fetchSpy.mockClear();

    // Still session 1 — the set survived the flush: repeat → no firstUses
    Trackless.feature("export_clicked");
    await Trackless.flush();
    expect(featureEvent(0).firstUses).toBeUndefined();

    // End session 1 (tab hidden) then start session 2 (tab visible)
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      writable: true,
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0); // let the keepalive flush settle
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange")); // startNewSession
    fetchSpy.mockClear();

    // Session 2: first use of the same feature → firstUses:1 again
    Trackless.feature("export_clicked");
    await Trackless.flush();
    expect(featureEvent(0).firstUses).toBe(1);

    // restore default visibility
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });
  });

  it("only feature events ever carry firstUses", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.view("home");
    Trackless.feature("export_clicked");
    Trackless.funnel("checkout", 0, "cart");
    Trackless.performance("api", 1.0);
    Trackless.error("boom");
    await Trackless.flush();

    const events = JSON.parse(fetchSpy.mock.calls[0][1].body).events;
    for (const e of events) {
      if (e.type !== "feature") expect(e.firstUses).toBeUndefined();
    }
    expect(events.find((e: any) => e.type === "feature").firstUses).toBe(1);
  });
});

// ─── 24. Error Reach — ErrorReachTracker (3 tests) ───────────────────────────

describe("ErrorReachTracker", () => {
  it("marks the first occurrence true and repeats false", () => {
    const tracker = new ErrorReachTracker();
    expect(tracker.firstOccurrence("api_timeout")).toBe(true);
    expect(tracker.firstOccurrence("api_timeout")).toBe(false);
    expect(tracker.firstOccurrence("api_timeout")).toBe(false);
  });

  it("dedups distinct names independently", () => {
    const tracker = new ErrorReachTracker();
    expect(tracker.firstOccurrence("api_timeout")).toBe(true);
    expect(tracker.firstOccurrence("parse_failed")).toBe(true);
    expect(tracker.firstOccurrence("api_timeout")).toBe(false);
    expect(tracker.firstOccurrence("parse_failed")).toBe(false);
  });

  it("clear() resets so the next occurrence counts as a first occurrence again", () => {
    const tracker = new ErrorReachTracker();
    expect(tracker.firstOccurrence("api_timeout")).toBe(true);
    tracker.clear();
    expect(tracker.firstOccurrence("api_timeout")).toBe(true);
  });
});

// ─── 25. Error Reach — buffer rollup of firstOccurrences (4 tests) ────────────

describe("Error Reach — buffer rollup", () => {
  it("addCountable sums firstOccurrences across adds (cross-session-boundary rollup)", () => {
    const buffer = new EventBuffer();
    buffer.add({ type: "error", name: "x", severity: "error", firstOccurrences: 1 }); // session 1
    buffer.add({ type: "error", name: "x", severity: "error", firstOccurrences: 1 }); // session 2, same key
    buffer.add({ type: "error", name: "x", severity: "error" }); // repeat, no marker

    const payloads = buffer.drain("production", { platform: "web" });
    const event = payloads[0].events.find((e) => e.name === "x");
    expect(event?.count).toBe(3);
    expect(event?.firstOccurrences).toBe(2);
  });

  it("a different-severity entry carries no firstOccurrences (never 0)", () => {
    const buffer = new EventBuffer();
    buffer.add({ type: "error", name: "x", severity: "warning", firstOccurrences: 1 });
    buffer.add({ type: "error", name: "x", severity: "fatal" }); // same name, separate key

    const payloads = buffer.drain("production", { platform: "web" });
    const events = payloads[0].events;
    const warning = events.find((e) => e.severity === "warning");
    const fatal = events.find((e) => e.severity === "fatal");
    expect(warning?.firstOccurrences).toBe(1);
    expect(fatal?.firstOccurrences).toBeUndefined();
    expect("firstOccurrences" in (fatal as object)).toBe(false);
  });

  it("a repeat-only entry carries no firstOccurrences", () => {
    const buffer = new EventBuffer();
    // Name already seen earlier this session and flushed — later ones arrive unmarked.
    buffer.add({ type: "error", name: "y", severity: "error" });
    buffer.add({ type: "error", name: "y", severity: "error" });

    const payloads = buffer.drain("production", { platform: "web" });
    const event = payloads[0].events.find((e) => e.name === "y");
    expect(event?.count).toBe(2);
    expect(event?.firstOccurrences).toBeUndefined();
  });

  it("drain drops a non-positive firstOccurrences so it never reaches the wire", () => {
    const buffer = new EventBuffer();
    buffer.add({ type: "error", name: "z", severity: "error", firstOccurrences: 0 });

    const payloads = buffer.drain("production", { platform: "web" });
    const event = payloads[0].events.find((e) => e.name === "z");
    expect(event?.firstOccurrences).toBeUndefined();
    expect("firstOccurrences" in (event as object)).toBe(false);
  });
});

// ─── 26. Error Reach — error() first-occurrence marking (8 tests) ─────────────

describe("Error Reach — error() first-occurrence marking", () => {
  function errorEvent(callIndex: number, name = "api_timeout"): any {
    const body = JSON.parse(fetchSpy.mock.calls[callIndex][1].body);
    return body.events.find((e: any) => e.type === "error" && e.name === name);
  }

  it("first error() carries firstOccurrences:1; a later repeat (separate flush) carries none", async () => {
    configure();
    await Trackless.flush(); // drain session:start
    fetchSpy.mockClear();

    Trackless.error("api_timeout"); // first occurrence
    await Trackless.flush();
    expect(errorEvent(0).firstOccurrences).toBe(1);
    fetchSpy.mockClear();

    Trackless.error("api_timeout"); // repeat, same session
    await Trackless.flush();
    expect(errorEvent(0).firstOccurrences).toBeUndefined();
  });

  it("repeats within a single flush roll up to count>1 with firstOccurrences:1", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.error("parse_failed");
    Trackless.error("parse_failed");
    Trackless.error("parse_failed");
    await Trackless.flush();

    const event = errorEvent(0, "parse_failed");
    expect(event.count).toBe(3);
    expect(event.firstOccurrences).toBe(1);
    // Wire invariant: 1 <= firstOccurrences <= count
    expect(event.firstOccurrences).toBeGreaterThanOrEqual(1);
    expect(event.firstOccurrences).toBeLessThanOrEqual(event.count);
  });

  it("distinct error names dedup independently", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.error("alpha");
    Trackless.error("beta");
    Trackless.error("alpha"); // repeat
    Trackless.error("beta"); // repeat
    await Trackless.flush();

    const events = JSON.parse(fetchSpy.mock.calls[0][1].body).events;
    const alpha = events.find((e: any) => e.name === "alpha");
    const beta = events.find((e: any) => e.name === "beta");
    expect(alpha.count).toBe(2);
    expect(alpha.firstOccurrences).toBe(1);
    expect(beta.count).toBe(2);
    expect(beta.firstOccurrences).toBe(1);
  });

  it("dedup runs on the normalized name (natural-string variants share one first occurrence)", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.error("API Timeout"); // normalizes to api_timeout → first occurrence
    Trackless.error("api_timeout"); // same normalized name → repeat
    await Trackless.flush();

    const errors = JSON.parse(fetchSpy.mock.calls[0][1].body).events.filter(
      (e: any) => e.type === "error",
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].name).toBe("api_timeout");
    expect(errors[0].count).toBe(2);
    expect(errors[0].firstOccurrences).toBe(1);
  });

  it("reach dedup is by name only, not name+severity+code", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.error("upload", Severity.WARNING, "e1"); // first occurrence of "upload"
    Trackless.error("upload", Severity.FATAL, "e2"); // same name, different severity/code
    await Trackless.flush();

    const events = JSON.parse(fetchSpy.mock.calls[0][1].body).events.filter(
      (e: any) => e.type === "error" && e.name === "upload",
    );
    const warning = events.find((e: any) => e.severity === "warning");
    const fatal = events.find((e: any) => e.severity === "fatal");
    expect(warning.firstOccurrences).toBe(1);
    expect(fatal.firstOccurrences).toBeUndefined();
    // Reach summed across variants is exactly 1 for this session.
    const total = events.reduce((s: number, e: any) => s + (e.firstOccurrences ?? 0), 0);
    expect(total).toBe(1);
  });

  it("first-occurrence set survives a mid-session flush but re-marks after session end", async () => {
    configure();
    await Trackless.flush(); // drain session:start
    fetchSpy.mockClear();

    // Session 1: first occurrence → firstOccurrences:1
    Trackless.error("api_timeout");
    await Trackless.flush();
    expect(errorEvent(0).firstOccurrences).toBe(1);
    fetchSpy.mockClear();

    // Still session 1 — the set survived the flush: repeat → no firstOccurrences
    Trackless.error("api_timeout");
    await Trackless.flush();
    expect(errorEvent(0).firstOccurrences).toBeUndefined();

    // End session 1 (tab hidden) then start session 2 (tab visible)
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      writable: true,
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0); // let the keepalive flush settle
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange")); // startNewSession
    fetchSpy.mockClear();

    // Session 2: first occurrence of the same error → firstOccurrences:1 again
    Trackless.error("api_timeout");
    await Trackless.flush();
    expect(errorEvent(0).firstOccurrences).toBe(1);

    // restore default visibility
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });
  });

  it("configure() starts a fresh session so the same error is marked again", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.error("api_timeout");
    await Trackless.flush();
    expect(errorEvent(0).firstOccurrences).toBe(1);

    configure(); // re-configure → new tracker, new session
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.error("api_timeout");
    await Trackless.flush();
    expect(errorEvent(0).firstOccurrences).toBe(1);
  });

  it("only error events ever carry firstOccurrences", async () => {
    configure();
    await Trackless.flush();
    fetchSpy.mockClear();

    Trackless.view("home");
    Trackless.feature("export_clicked");
    Trackless.funnel("checkout", 0, "cart");
    Trackless.performance("api", 1.0);
    Trackless.error("boom");
    await Trackless.flush();

    const events = JSON.parse(fetchSpy.mock.calls[0][1].body).events;
    for (const e of events) {
      if (e.type !== "error") expect(e.firstOccurrences).toBeUndefined();
    }
    expect(events.find((e: any) => e.type === "error").firstOccurrences).toBe(1);
  });
});

// ─── 27. Rejected Names Never Echo Raw Input (5 tests) ───────────────────────

describe("Rejected Names Never Echo Raw Input", () => {
  // A rejected name is raw, pre-normalization caller input. It reaches the
  // warning *because* normalization failed, so no PII-stripped form of it
  // exists — it must not be echoed to the console or handed to onError.
  //
  // Note on which inputs actually reach this path: PII stripping replaces a
  // matched email/phone/SSN with the literal "[REDACTED]", which normalizes to
  // the non-empty "redacted". A name containing a *recognized* email therefore
  // always normalizes successfully and never reaches the rejection branch. The
  // names that do reach it are the ones the PII guard does not recognize —
  // most importantly non-Latin-script text, which includes personal names.
  const REJECTED_NAME = "Ольга Иванова";
  const EMAIL = "user@example.com";

  it("the rejection warning does not contain the raw name", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    configure();

    Trackless.feature(REJECTED_NAME);

    const warns = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(warns.some((w) => w.includes("event name rejected"))).toBe(true);
    expect(warns.some((w) => w.includes(REJECTED_NAME))).toBe(false);

    warnSpy.mockRestore();
  });

  it("the onError message does not contain the raw name", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const errors: Error[] = [];
    configure({ onError: (e) => errors.push(e) });

    Trackless.feature(REJECTED_NAME);

    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors.some((e) => e.message.includes("Invalid event name"))).toBe(true);
    expect(errors.some((e) => e.message.includes(REJECTED_NAME))).toBe(false);
  });

  it("every entry point that rejects a name keeps it out of warnings and errors", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errors: Error[] = [];
    configure({ onError: (e) => errors.push(e) });

    Trackless.view(REJECTED_NAME);
    Trackless.feature(REJECTED_NAME);
    Trackless.funnel(REJECTED_NAME, 0, REJECTED_NAME);
    Trackless.performance(REJECTED_NAME, 1);
    Trackless.error(REJECTED_NAME);

    const emitted = [
      ...warnSpy.mock.calls.map((c) => String(c[0])),
      ...errors.map((e) => e.message),
    ];
    expect(emitted.length).toBeGreaterThanOrEqual(5);
    expect(emitted.some((m) => m.includes(REJECTED_NAME))).toBe(false);

    warnSpy.mockRestore();
  });

  it("an email in an accepted name is redacted before it reaches any log output", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errors: Error[] = [];
    configure({ debugLogging: true, onError: (e) => errors.push(e) });

    Trackless.feature(`signup ${EMAIL}`, EMAIL);
    Trackless.view(`profile ${EMAIL}`);

    const emitted = [
      ...warnSpy.mock.calls.map((c) => String(c[0])),
      ...logSpy.mock.calls.map((c) => String(c[0])),
      ...errors.map((e) => e.message),
    ];
    expect(emitted.length).toBeGreaterThanOrEqual(2);
    for (const message of emitted) {
      expect(message).not.toContain(EMAIL);
      expect(message).not.toContain("@");
    }

    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("the rejection warning still respects suppressWarnings", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    configure({ suppressWarnings: true, onError: () => {} });

    Trackless.feature(REJECTED_NAME);

    const warns = warnSpy.mock.calls.filter((c) => String(c[0]).includes("[Trackless]"));
    expect(warns.length).toBe(0);

    warnSpy.mockRestore();
  });
});
