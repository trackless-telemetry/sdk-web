/**
 * Environment default — a local-development host defaults to sandbox.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Trackless } from "../src/Trackless.js";
import type { TracklessConfig } from "../src/types.js";
import { detectContext, isLocalDevHost } from "../src/context.js";

describe("isLocalDevHost", () => {
  it.each([
    "localhost",
    "LOCALHOST",
    "LocalHost",
    "app.localhost",
    "my-app.dev.localhost",
    // The fully-qualified spelling: `location.hostname` keeps the trailing dot
    "localhost.",
    "app.localhost.",
    "127.0.0.1",
    "127.0.1.1",
    "127.255.255.255",
    "[::1]",
    "::1",
    "0.0.0.0",
  ])("counts %j as a local-development host", (host) => {
    expect(isLocalDevHost(host)).toBe(true);
  });

  it.each([
    // Look-alikes
    "localhost.example.com",
    "notlocalhost",
    "localhost-app.com",
    "localhost..",
    "localhost.example.com.",
    ".",
    "127.evil.com",
    "127.0.0.1.nip.io",
    "127.0.0",
    "127.0.0.256",
    "127.0.0.1:3000",
    "1127.0.0.1",
    // LAN / private addresses
    "192.168.1.10",
    "10.0.0.5",
    "172.16.0.1",
    "169.254.1.1",
    "[fe80::1]",
    "[::]",
    // Local-ish TLDs the integrator must opt into
    "myapp.local",
    "myapp.test",
    // Ordinary hosts
    "example.com",
    "www.example.com",
    "staging.example.com",
    // file: pages (Electron production) report an empty hostname
    "",
  ])("does not count %j", (host) => {
    expect(isLocalDevHost(host)).toBe(false);
  });

  it.each([undefined, null, 127, {}])("does not count a non-string (%j)", (host) => {
    expect(isLocalDevHost(host)).toBe(false);
  });
});

describe("configure() environment default", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const originalLocation = window.location;

  function setHostname(hostname: string): void {
    Object.defineProperty(window, "location", {
      value: { hostname, pathname: "/" },
      writable: true,
      configurable: true,
    });
  }

  async function sentEnvironment(overrides: Partial<TracklessConfig> = {}): Promise<unknown> {
    Trackless.configure({
      apiKey: "tl_0123456789abcdef0123456789abcdef",
      endpoint: "https://api.test.com",
      flushIntervalSeconds: 999_999,
      ...overrides,
    });
    Trackless.feature("export_clicked");
    await Trackless.flush();
    expect(fetchSpy).toHaveBeenCalled();
    return JSON.parse(fetchSpy.mock.calls[0][1].body).environment;
  }

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
    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("an unset environment on localhost sends sandbox", async () => {
    setHostname("localhost");
    expect(await sentEnvironment()).toBe("sandbox");
  });

  it("an unset environment on a loopback IP sends sandbox", async () => {
    setHostname("127.0.0.1");
    expect(await sentEnvironment()).toBe("sandbox");
  });

  it("an explicit production on localhost sends production", async () => {
    setHostname("localhost");
    expect(await sentEnvironment({ environment: "production" })).toBe("production");
  });

  it("an explicit sandbox on a public host sends sandbox", async () => {
    setHostname("example.com");
    expect(await sentEnvironment({ environment: "sandbox" })).toBe("sandbox");
  });

  it("an unset environment on example.com sends production", async () => {
    setHostname("example.com");
    expect(await sentEnvironment()).toBe("production");
  });

  it("an unset environment on a file: page (empty hostname) sends production", async () => {
    setHostname("");
    expect(await sentEnvironment()).toBe("production");
  });

  it("an unset environment on a LAN IP sends production", async () => {
    setHostname("192.168.1.10");
    expect(await sentEnvironment()).toBe("production");
  });

  it.each(["app.localhost", "shop.example.com"])(
    "the page hostname %s is never sent",
    async (host) => {
      setHostname(host);
      Trackless.configure({
        apiKey: "tl_0123456789abcdef0123456789abcdef",
        endpoint: "https://api.test.com",
        flushIntervalSeconds: 999_999,
      });
      Trackless.feature("export_clicked");
      await Trackless.flush();
      const raw: string = fetchSpy.mock.calls[0][1].body;
      const body = JSON.parse(raw);
      expect(body.context).not.toHaveProperty("distributionChannel");
      expect(raw).not.toContain(host);
    },
  );
});

describe("detectContext", () => {
  it("carries no distributionChannel", () => {
    expect(detectContext()).not.toHaveProperty("distributionChannel");
  });
});
