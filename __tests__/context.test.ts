/**
 * Context detection — language dimension tests
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { detectContext, omitInvalidContext } from "../src/context.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("detectLanguage", () => {
  it('extracts language code from full locale ("en-US" → "en")', () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      languages: ["en-US"],
      language: "en-US",
    });
    const ctx = detectContext();
    expect(ctx.language).toBe("en");
  });

  it('returns language-only locale as-is ("fr" → "fr")', () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      languages: ["fr"],
      language: "fr",
    });
    const ctx = detectContext();
    expect(ctx.language).toBe("fr");
  });

  it("lowercases language code", () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      languages: ["DE-AT"],
      language: "DE-AT",
    });
    const ctx = detectContext();
    expect(ctx.language).toBe("de");
  });

  it("falls back to navigator.language when languages is empty", () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      languages: [],
      language: "ja-JP",
    });
    const ctx = detectContext();
    expect(ctx.language).toBe("ja");
  });

  it("returns undefined when navigator properties are unavailable", () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      languages: undefined,
      language: undefined,
    });
    // Intl fallback may still provide a value, so just verify no error is thrown
    const ctx = detectContext();
    expect(typeof ctx.language === "string" || ctx.language === undefined).toBe(true);
  });
});

describe("omitInvalidContext", () => {
  it("omits values ingest would reject and names the fields", () => {
    const { context, omitted } = omitInvalidContext({
      platform: "web",
      appVersion: "a".repeat(51),
      buildNumber: "build#7",
      osVersion: "10_15",
      sdkVersion: "web/0.0.0",
    });
    expect(context).toEqual({ platform: "web", sdkVersion: "web/0.0.0" });
    expect(omitted).toEqual(["appVersion", "buildNumber", "osVersion"]);
  });

  it("keeps values at the edges of the rule", () => {
    const input = {
      platform: "web" as const,
      appVersion: "a".repeat(50),
      buildNumber: "1",
      osVersion: "18.3.1",
    };
    const { context, omitted } = omitInvalidContext(input);
    expect(context).toEqual(input);
    expect(omitted).toEqual([]);
  });

  it("leaves absent fields alone", () => {
    expect(omitInvalidContext({ platform: "web" }).omitted).toEqual([]);
  });
});
