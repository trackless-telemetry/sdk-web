/**
 * Environment default outside a browser — no window means production.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from "vitest";
import { defaultEnvironment } from "../src/context.js";

describe("defaultEnvironment without a window", () => {
  it("is production", () => {
    expect(typeof window).toBe("undefined");
    expect(defaultEnvironment()).toBe("production");
  });
});
