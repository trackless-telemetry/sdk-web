/**
 * Trackless Web SDK — `captureUncaught`. Mirrors the Swift
 * UncaughtExceptionTests and the Android UncaughtExceptionTest.
 *
 * Each test imports a fresh copy of the SDK (`vi.resetModules()`), because the
 * reserved-prefix warning is once per page load. Errors are dispatched as
 * `ErrorEvent`s on `window`; jsdom has no `PromiseRejectionEvent`, so a
 * minimal one stands in.
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

interface SentEvent {
  type: string;
  name: string;
  severity?: string;
  code?: string;
  count?: number;
  firstOccurrences?: number;
  stepIndex?: number;
}

/** What jsdom lacks: an event carrying `reason` and `promise`. */
class TestPromiseRejectionEvent extends Event {
  readonly reason: unknown;
  readonly promise: Promise<unknown>;
  constructor(reason: unknown) {
    super("unhandledrejection", { cancelable: true });
    this.reason = reason;
    this.promise = Promise.resolve();
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

function configure(overrides: Partial<TracklessConfig> = {}): void {
  Trackless.configure({
    apiKey: TEST_API_KEY,
    endpoint: "https://api.test.com",
    flushIntervalSeconds: 999_999,
    captureUncaught: true,
    ...overrides,
  });
}

/** Dispatch a window `error` event as the browser would for an uncaught throw. */
function throwUncaught(
  error: unknown,
  filename = "https://app.example.com/assets/index.js",
): ErrorEvent {
  const event = new ErrorEvent("error", {
    message: "Uncaught: contact jane.doe@example.com",
    filename,
    lineno: 42,
    colno: 7,
    error,
    cancelable: true,
  });
  window.dispatchEvent(event);
  return event;
}

function rejectUnhandled(reason: unknown): Event {
  const event = new TestPromiseRejectionEvent(reason);
  window.dispatchEvent(event);
  return event;
}

function bodies(): string[] {
  return fetchSpy.mock.calls.map((call) => String(call[1].body));
}

function sentEvents(): SentEvent[] {
  return bodies().flatMap((body) => JSON.parse(body).events as SentEvent[]);
}

async function sentUncaught(): Promise<SentEvent[]> {
  await Trackless.flush();
  return sentEvents().filter((e) => e.type === "error" && e.name === "trackless.uncaught");
}

function reservedWarnings(): string[] {
  return warnSpy.mock.calls
    .map((call: unknown[]) => String(call[0]))
    .filter((w) => w.includes("reserved"));
}

function setVisibility(state: "hidden" | "visible"): void {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    writable: true,
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

/**
 * Vitest's jsdom environment reports a window `error` event as an uncaught
 * exception whenever no other `error` listener is attached, which is the case
 * whenever the SDK's is not. This one keeps those dispatches quiet; it never
 * calls `preventDefault()`.
 */
const quietListener = (): void => {};

beforeEach(async () => {
  window.addEventListener("error", quietListener);
  vi.resetModules();
  ({ Trackless } = await import("../src/Trackless.js"));
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.removeEventListener("error", quietListener);
});

// ── Recording ───────────────────────────────────────────────────────────

describe("captureUncaught", () => {
  it("is off by default: an uncaught error records nothing", async () => {
    configure({ captureUncaught: undefined });
    throwUncaught(new TypeError("x is undefined"));
    expect(await sentUncaught()).toEqual([]);
  });

  it("records an uncaught error as trackless.uncaught with the error's name", async () => {
    configure();
    throwUncaught(new TypeError("x is undefined"));
    throwUncaught(new RangeError("bad length"));
    throwUncaught(new TypeError("y is undefined"));

    const events = await sentUncaught();
    expect(events.map((e) => [e.code, e.count])).toEqual(
      expect.arrayContaining([
        ["typeerror", 2],
        ["rangeerror", 1],
      ]),
    );
    expect(events.every((e) => e.severity === "error")).toBe(true);
    // The first occurrence of the name in the session, once.
    expect(events.reduce((sum, e) => sum + (e.firstOccurrences ?? 0), 0)).toBe(1);
  });

  it("uses a custom error's name, normalized", async () => {
    class CheckoutFailure extends Error {
      override name = "CheckoutFailure";
    }
    configure();
    throwUncaught(new CheckoutFailure("card declined"));
    expect((await sentUncaught()).map((e) => e.code)).toEqual(["checkoutfailure"]);
  });

  it("sends unknown for an error name normalization rejects", async () => {
    const error = new Error("boom");
    error.name = "abcdefabcdefabcdefabcdefabcdef";
    configure();
    throwUncaught(error);
    expect((await sentUncaught()).map((e) => e.code)).toEqual(["unknown"]);
  });

  it("sends non_error for a thrown value that is not an Error", async () => {
    configure();
    throwUncaught("a thrown string");
    expect((await sentUncaught()).map((e) => e.code)).toEqual(["non_error"]);
  });

  it("records an unhandled rejection with the reason's name", async () => {
    configure();
    rejectUnhandled(new TypeError("failed to fetch"));
    expect((await sentUncaught()).map((e) => e.code)).toEqual(["typeerror"]);
  });

  it("sends non_error for a rejection whose reason is not an Error", async () => {
    configure();
    rejectUnhandled("user 4471 not found");
    rejectUnhandled({ name: "TypeError", message: "looks like one" });
    rejectUnhandled(undefined);
    const events = await sentUncaught();
    expect(events.map((e) => [e.code, e.count])).toEqual([["non_error", 3]]);
  });

  it("does not count toward the session's depth", async () => {
    configure();
    Trackless.feature("export");
    throwUncaught(new TypeError("x"));
    await Trackless.destroy();
    const end = sentEvents().find((e) => e.type === "session" && e.name === "end");
    expect(end?.stepIndex).toBe(1);
  });

  it("never calls preventDefault, so the browser still logs the error", () => {
    configure();
    const errorEvent = throwUncaught(new TypeError("x"));
    const rejection = rejectUnhandled(new TypeError("y"));
    expect(errorEvent.defaultPrevented).toBe(false);
    expect(rejection.defaultPrevented).toBe(false);
  });

  it("puts nothing of the message, file name or stack in the payload", async () => {
    configure();
    const error = new TypeError("secret-message for jane.doe@example.com");
    error.stack =
      "TypeError: secret-message\n    at secretFunction (https://app.example.com/secret-path.js:1:2)";
    throwUncaught(error, "https://app.example.com/secret-path.js");
    rejectUnhandled(new RangeError("secret-reason"));
    await Trackless.flush();

    const payload = bodies().join("\n").toLowerCase();
    expect(payload).toContain("typeerror");
    expect(payload).toContain("rangeerror");
    for (const leak of [
      "secret",
      "jane",
      "example.com",
      "app.example",
      ".js",
      "uncaught:",
      ":42",
    ]) {
      expect(payload, leak).not.toContain(leak);
    }
  });
});

// ── Skipped events ──────────────────────────────────────────────────────

describe("captureUncaught skips", () => {
  it("an opaque cross-origin error with no error object", async () => {
    configure();
    window.dispatchEvent(new ErrorEvent("error", { message: "Script error.", filename: "" }));
    throwUncaught(null);
    throwUncaught(undefined);
    expect(await sentUncaught()).toEqual([]);
  });

  it.each([
    "chrome-extension://abcdefghijklmnop/content.js",
    "moz-extension://1234/inject.js",
    "safari-extension://com.example.ext/script.js",
    "safari-web-extension://ABCD/script.js",
    "CHROME-EXTENSION://upper/content.js",
  ])("an error from an extension script: %s", async (filename) => {
    configure();
    throwUncaught(new TypeError("from an extension"), filename);
    expect(await sentUncaught()).toEqual([]);
  });

  it("a non-error event dispatched as error (a resource load failure)", async () => {
    configure();
    window.dispatchEvent(new Event("error"));
    expect(await sentUncaught()).toEqual([]);
  });
});

// ── Lifecycle ───────────────────────────────────────────────────────────

describe("captureUncaught listeners", () => {
  function listenerCalls(spy: ReturnType<typeof vi.spyOn>, type: string): unknown[] {
    return spy.mock.calls
      .filter((call: unknown[]) => call[0] === type)
      .map((call: unknown[]) => call[1]);
  }

  it("are added on configure and removed on destroy", async () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    configure();
    const [onError] = listenerCalls(add, "error");
    const [onRejection] = listenerCalls(add, "unhandledrejection");
    expect(onError).toBeTypeOf("function");
    expect(onRejection).toBeTypeOf("function");

    await Trackless.destroy();
    expect(listenerCalls(remove, "error")).toContain(onError);
    expect(listenerCalls(remove, "unhandledrejection")).toContain(onRejection);
  });

  it("are removed on setEnabled(false) and added once again on setEnabled(true)", async () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    configure();
    const [onError] = listenerCalls(add, "error");

    Trackless.setEnabled(false);
    expect(listenerCalls(remove, "error")).toContain(onError);
    throwUncaught(new TypeError("while disabled"));

    Trackless.setEnabled(true);
    Trackless.setEnabled(true);
    expect(listenerCalls(add, "error")).toHaveLength(2);
    throwUncaught(new TypeError("enabled again"));
    expect((await sentUncaught()).map((e) => e.count)).toEqual([1]);
  });

  it("are not added while configured with enabled: false", () => {
    const add = vi.spyOn(window, "addEventListener");
    configure({ enabled: false });
    expect(listenerCalls(add, "error")).toEqual([]);
    expect(listenerCalls(add, "unhandledrejection")).toEqual([]);
  });

  it("are removed by a reconfigure that turns the option off", async () => {
    const remove = vi.spyOn(window, "removeEventListener");
    configure();
    configure({ captureUncaught: false });
    expect(listenerCalls(remove, "error")).toHaveLength(1);
    throwUncaught(new TypeError("after"));
    expect(await sentUncaught()).toEqual([]);
  });

  it("a reconfigure keeps exactly one pair attached", async () => {
    configure();
    configure({ apiKey: OTHER_API_KEY });
    throwUncaught(new TypeError("once"));
    expect((await sentUncaught()).map((e) => e.count)).toEqual([1]);
  });

  it("changing captureUncaught counts as changed settings", async () => {
    configure({ captureUncaught: false });
    Trackless.startTimer("open");
    configure({ captureUncaught: true });
    // A changed configure discards open timers; stopping one sends nothing.
    Trackless.stopTimer("open");
    Trackless.startTimer("open");
    configure({ captureUncaught: true });
    Trackless.stopTimer("open");
    await Trackless.flush();
    expect(sentEvents().filter((e) => e.type === "performance")).toHaveLength(1);
    expect(sentEvents().filter((e) => e.type === "session" && e.name === "end")).toHaveLength(1);
  });
});

// ── Reserved prefix on error() and info() ───────────────────────────────

describe("reserved trackless. prefix on error() and info()", () => {
  it("error() warns once per page load and sends the name anyway", async () => {
    configure({ captureUncaught: false });
    Trackless.error("Trackless.Uncaught", "boom");
    Trackless.info("trackless.tier", "paid");
    Trackless.error("api_timeout");

    expect(reservedWarnings()).toHaveLength(1);
    expect(reservedWarnings()[0]).toMatch(/^\[Trackless\] error name "trackless\.uncaught"/);
    await Trackless.flush();
    const names = sentEvents().map((e) => e.name);
    expect(names).toEqual(
      expect.arrayContaining(["trackless.uncaught", "trackless.tier", "api_timeout"]),
    );
  });

  it("info() names its call in the warning", () => {
    configure({ captureUncaught: false });
    Trackless.info("trackless.tier", "paid");
    expect(reservedWarnings()).toHaveLength(1);
    expect(reservedWarnings()[0]).toContain('info name "trackless.tier"');
  });

  it("is not triggered by the SDK's own uncaught send", () => {
    configure();
    throwUncaught(new TypeError("x"));
    rejectUnhandled("y");
    expect(reservedWarnings()).toEqual([]);
  });
});
