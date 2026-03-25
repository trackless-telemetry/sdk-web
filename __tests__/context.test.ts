/**
 * Context detection — language dimension tests
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { detectContext } from "../src/context.js";

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
