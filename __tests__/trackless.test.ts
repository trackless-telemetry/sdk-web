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
