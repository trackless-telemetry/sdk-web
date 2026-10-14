class f {
  constructor(t = 1e3) {
    this.aggregated = /* @__PURE__ */ new Map(), this.individual = [], this.maxItems = t;
  }
  /** Add an event to the buffer. Returns true if accepted. */
  add(t) {
    return t.type === "funnel" || t.type === "session" && t.name !== "duration" ? this.totalSize >= this.maxItems ? !1 : (this.individual.push({ ...t }), !0) : t.type === "performance" ? this.addPerformance(t) : this.addCountable(t);
  }
  addCountable(t) {
    const r = this.rollupKey(t), n = this.aggregated.get(r);
    return n ? (n.count = (n.count ?? 1) + (t.count ?? 1), t.firstUses !== void 0 && (n.firstUses = (n.firstUses ?? 0) + t.firstUses), t.firstOccurrences !== void 0 && (n.firstOccurrences = (n.firstOccurrences ?? 0) + t.firstOccurrences), !0) : this.totalSize >= this.maxItems ? !1 : (this.aggregated.set(r, { ...t, count: t.count ?? 1 }), !0);
  }
  addPerformance(t) {
    const r = this.rollupKey(t), n = this.aggregated.get(r);
    if (n)
      return n.durations || (n.durations = []), t.duration !== void 0 ? n.durations.push(t.duration) : t.durations && n.durations.push(...t.durations), delete n.duration, !0;
    if (this.totalSize >= this.maxItems) return !1;
    const i = { ...t };
    return i.duration !== void 0 ? (i.durations = [i.duration], delete i.duration) : i.durations || (i.durations = []), this.aggregated.set(r, i), !0;
  }
  /** Drain the buffer into an EventPayload and clear it. */
  drain(t, r) {
    for (const o of this.aggregated.values())
      o.firstUses !== void 0 && !(o.firstUses >= 1) && delete o.firstUses, o.firstOccurrences !== void 0 && !(o.firstOccurrences >= 1) && delete o.firstOccurrences;
    const n = [...this.aggregated.values(), ...this.individual];
    if (this.aggregated.clear(), this.individual = [], n.length === 0) return [];
    const i = /* @__PURE__ */ new Date(), s = `${i.getFullYear()}-${String(i.getMonth() + 1).padStart(2, "0")}-${String(i.getDate()).padStart(2, "0")}`, c = [];
    for (let o = 0; o < n.length; o += 100)
      c.push({
        date: s,
        environment: t,
        context: r,
        events: n.slice(o, o + 100)
      });
    return c;
  }
  /** Clear the buffer without draining */
  clear() {
    this.aggregated.clear(), this.individual = [];
  }
  /** Total number of unique items in the buffer */
  get totalSize() {
    return this.aggregated.size + this.individual.length;
  }
  /** Check if the buffer is empty */
  get isEmpty() {
    return this.totalSize === 0;
  }
  /** Build the rollup key for count-aggregatable events */
  rollupKey(t) {
    switch (t.type) {
      case "feature":
      case "view":
        return `${t.type}|${t.name}|${t.detail ?? ""}`;
      case "error":
        return `${t.type}|${t.name}|${t.severity ?? ""}|${t.code ?? ""}`;
      case "performance":
        return `${t.type}|${t.name}|${t.threshold !== void 0 ? String(t.threshold) : ""}`;
      case "session":
        return `${t.type}|${t.name}`;
      default:
        return `${t.type}|${t.name}`;
    }
  }
}
const h = [3e4, 6e4, 3e5, 9e5, 36e5];
class p {
  constructor() {
    this.consecutiveFailures = 0, this.nextRetryAt = 0;
  }
  /** Can we attempt a flush right now? */
  canAttempt() {
    return this.consecutiveFailures === 0 ? !0 : Date.now() >= this.nextRetryAt;
  }
  /** Record a successful flush — resets backoff entirely */
  recordSuccess() {
    this.consecutiveFailures = 0, this.nextRetryAt = 0;
  }
  /** Record a flush failure — advances backoff schedule */
  recordFailure() {
    this.consecutiveFailures++;
    const t = Math.min(this.consecutiveFailures - 1, h.length - 1);
    this.nextRetryAt = Date.now() + h[t];
  }
  /** Current consecutive failure count (for testing) */
  get failures() {
    return this.consecutiveFailures;
  }
}
const S = "0.5.1", $ = {
  version: S
};
function d() {
  return typeof navigator < "u" ? navigator : {};
}
function R(a, t) {
  return {
    platform: "web",
    osVersion: N(),
    deviceClass: T(),
    region: D(),
    language: C(),
    browser: I(),
    os: O(),
    appVersion: a,
    buildNumber: t,
    sdkVersion: `web/${$.version}`
    // No install-age or distribution-channel field: the SDKs read no install
    // metadata, and the page hostname is never sent.
  };
}
const F = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
function L(a) {
  if (typeof a != "string" || a === "") return !1;
  const t = a.toLowerCase().replace(/\.$/, "");
  if (t === "localhost" || t.endsWith(".localhost") || t === "[::1]" || t === "::1" || t === "0.0.0.0") return !0;
  const r = F.exec(t);
  return r !== null && r.slice(1).every((n) => Number(n) <= 255);
}
function A() {
  var a;
  try {
    return typeof window > "u" ? "production" : L((a = window.location) == null ? void 0 : a.hostname) ? "sandbox" : "production";
  } catch {
    return "production";
  }
}
function N() {
  try {
    const a = d().userAgentData;
    if (a != null && a.platformVersion) {
      const s = a.platformVersion.split(".")[0];
      if (s) return s;
    }
    const t = typeof navigator < "u" ? navigator.userAgent : "";
    if (!t) return;
    let r;
    const n = t.match(/Windows NT (\d+\.\d+)/);
    if (n && (r = n[1]), !r) {
      const s = t.match(/(?:iPhone|CPU) OS (\d+)[_.](\d+)/);
      s && (r = `${s[1]}.${s[2]}`);
    }
    if (!r) {
      const s = t.match(/Android (\d+(?:\.\d+)?)/);
      if (s) {
        const c = s[1];
        r = c.includes(".") ? c : `${c}.0`;
      }
    }
    if (!r) {
      const s = t.match(/CrOS \S+ (\d+\.\d+)/);
      s && (r = s[1]);
    }
    return (r == null ? void 0 : r.split(".")[0]) || void 0;
  } catch {
    return;
  }
}
function T() {
  try {
    if (typeof navigator > "u" || typeof window > "u")
      return;
    const a = navigator.maxTouchPoints > 0, t = window.innerWidth;
    return a && t < 768 ? "phone" : a && t < 1024 ? "tablet" : "desktop";
  } catch {
    return;
  }
}
function D() {
  var a, t;
  try {
    const r = ((a = navigator.languages) == null ? void 0 : a[0]) ?? navigator.language;
    if (r) {
      const s = r.split("-");
      if (s[1]) return s[1].toUpperCase();
    }
    return (t = new Intl.DateTimeFormat().resolvedOptions().locale.split("-")[1]) == null ? void 0 : t.toUpperCase();
  } catch {
    return;
  }
}
function C() {
  var a;
  try {
    const t = ((a = navigator.languages) == null ? void 0 : a[0]) ?? navigator.language;
    if (t) {
      const i = t.split("-")[0].toLowerCase();
      if (i) return i;
    }
    return new Intl.DateTimeFormat().resolvedOptions().locale.split("-")[0].toLowerCase() || void 0;
  } catch {
    return;
  }
}
function I() {
  try {
    const a = d();
    if (a.webdriver) return "bot";
    const t = a.userAgentData;
    if (t != null && t.brands) {
      const r = t.brands.map((n) => n.brand.toLowerCase());
      if (r.some((n) => n.includes("edge") || n.includes("edg"))) return "edge";
      if (r.some((n) => n.includes("firefox"))) return "firefox";
      if (r.some((n) => n.includes("chrome") || n.includes("chromium"))) return "chrome";
    }
    return navigator.vendor === "Apple Computer, Inc." ? "safari" : "other";
  } catch {
    return "other";
  }
}
function O() {
  try {
    const a = d().userAgentData;
    if (a != null && a.platform) {
      const r = a.platform.toLowerCase();
      return r === "macos" || r === "mac os x" ? "macos" : r === "windows" ? "windows" : r === "linux" || r.includes("cros") ? "linux" : r === "android" ? "android" : r === "ios" ? "ios" : "other";
    }
    const t = navigator.userAgent;
    return /iPhone|iPad|iPod/.test(t) ? "ios" : /Mac OS X/.test(t) ? "macos" : /Windows/.test(t) ? "windows" : /Android/.test(t) ? "android" : /Linux|CrOS/.test(t) ? "linux" : "other";
  } catch {
    return "other";
  }
}
class g {
  constructor() {
    this.startTime = 0, this.depth = 0, this.active = !1;
  }
  /** Start a new session. Returns true if a new session was started. */
  start() {
    return this.active ? !1 : (this.startTime = Date.now(), this.depth = 0, this.active = !0, !0);
  }
  /** Record activity (non-session event). Increments depth. */
  recordActivity() {
    this.active && this.depth++;
  }
  /** End the current session. Returns session duration in seconds and depth, or null if no active session. */
  end() {
    if (!this.active) return null;
    this.active = !1;
    const t = Date.now() - this.startTime;
    return { duration: Math.round(t / 1e3), depth: this.depth };
  }
  /** Whether a session is currently active. */
  get isActive() {
    return this.active;
  }
  /** Current session depth. */
  get currentDepth() {
    return this.depth;
  }
  /** Clean up. */
  destroy() {
    this.active = !1;
  }
}
class m {
  constructor() {
    this.funnels = /* @__PURE__ */ new Map();
  }
  /**
   * Check and record a funnel step for deduplication.
   *
   * @returns true if the step was newly recorded, false if it was a duplicate
   */
  step(t, r) {
    let n = this.funnels.get(t);
    return n || (n = /* @__PURE__ */ new Set(), this.funnels.set(t, n)), n.has(r) ? !1 : (n.add(r), !0);
  }
  /** Clear all funnel state (call on session end). */
  clear() {
    this.funnels.clear();
  }
}
class v {
  constructor() {
    this.seen = /* @__PURE__ */ new Set();
  }
  /**
   * Check and record the first use of a feature name this session.
   *
   * @returns true if this is the first use of the name this session, false otherwise
   */
  firstUse(t) {
    return this.seen.has(t) ? !1 : (this.seen.add(t), !0);
  }
  /** Clear all first-use state (call on session end). */
  clear() {
    this.seen.clear();
  }
}
class y {
  constructor() {
    this.seen = /* @__PURE__ */ new Set();
  }
  /**
   * Check and record the first occurrence of an error name this session.
   *
   * @returns true if this is the first occurrence of the name this session, false otherwise
   */
  firstOccurrence(t) {
    return this.seen.has(t) ? !1 : (this.seen.add(t), !0);
  }
  /** Clear all first-occurrence state (call on session end). */
  clear() {
    this.seen.clear();
  }
}
const U = 1e4;
async function V(a, t, r, n = U, i = !1) {
  const s = new AbortController(), c = setTimeout(() => s.abort(), n);
  try {
    const o = await fetch(a, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": t
      },
      body: JSON.stringify(r),
      signal: s.signal,
      keepalive: i
    });
    clearTimeout(c);
    let l;
    try {
      l = await o.json();
    } catch {
    }
    return { status: o.status, body: l };
  } catch (o) {
    throw clearTimeout(c), o;
  }
}
const z = /^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/, u = 100, w = "it normalized to an empty or disallowed value (raw name omitted: it may contain PII)", E = 60, M = 1e4, H = 6e4, P = 100, x = "https://api.tracklesstelemetry.com", X = 50 * 1024, W = {
  /** @deprecated Nothing reads `debug` — it is sent as `info`. Call `Trackless.info(name, detail?)`. */
  DEBUG: "debug",
  /** @deprecated Call `Trackless.info(name, detail?)` instead of passing this to `error()`. */
  INFO: "info",
  /** @deprecated Nothing reads `warning` — it is sent as `error`. Call `Trackless.error(name, code?)`. */
  WARNING: "warning",
  /** The level `error()` sends. Passing it explicitly is redundant. */
  ERROR: "error",
  /** @deprecated Nothing reads `fatal` — it is sent as `error`. Call `Trackless.error(name, code?)`. */
  FATAL: "fatal"
}, B = new Set(Object.values(W));
function G(a) {
  return a === "info" || a === "debug" ? "info" : "error";
}
const e = class e {
  /** Whether the SDK has been configured and is ready to record events. */
  static get isConfigured() {
    return e.configured && !e.destroyed;
  }
  /**
   * Configure the SDK and start a new session.
   *
   * Safe to call again at runtime, for example to switch API key when the user
   * changes organization. A repeat call whose settings all match the running
   * configuration keeps the current session and buffer and only replaces
   * `onError`. A call that changes any setting ends the current session, sends
   * its buffered events under the previous key, endpoint and environment, and
   * then starts fresh exactly as a first call does.
   */
  static configure(t) {
    try {
      const r = {
        apiKey: t.apiKey,
        endpoint: t.endpoint ?? x,
        environment: t.environment ?? A(),
        enabled: t.enabled ?? !0,
        flushIntervalSeconds: t.flushIntervalSeconds ?? E,
        autoScreenTracking: t.autoScreenTracking ?? !1,
        debugLogging: t.debugLogging ?? !1,
        suppressWarnings: t.suppressWarnings ?? !1,
        appVersion: t.appVersion,
        buildNumber: t.buildNumber
      };
      let n = !1;
      if (e.isConfigured) {
        if (e.matchesRunningSettings(r)) {
          e.onError = t.onError ?? (() => {
          }), e.debug("configure — settings unchanged, keeping the current session");
          return;
        }
        e.retireRunningConfiguration(), n = !0;
      }
      e.apiKey = r.apiKey, e.endpoint = r.endpoint, e.environment = r.environment, e.enabled = r.enabled, e.onError = t.onError ?? (() => {
      }), e.flushIntervalSeconds = r.flushIntervalSeconds, e.autoScreenTracking = r.autoScreenTracking, e.debugLogging = r.debugLogging, e.suppressWarnings = r.suppressWarnings, e.appVersion = r.appVersion, e.buildNumber = r.buildNumber, e.buffer = new f(), e.circuitBreaker = new p(), e.context = R(r.appVersion, r.buildNumber), e.session = new g(), e.funnels = new m(), e.featureReach = new v(), e.errorReach = new y(), e.screenViewCooldowns = /* @__PURE__ */ new Map(), e.bufferFullWarned = !1, e.preConfigureWarned = !1, e.destroyed = !1, e.configured = !0, n && e.debug(
        "reconfigured — previous session ended and flushed under the previous settings"
      ), e.debug(
        `configured — env=${e.environment} endpoint=${e.endpoint} flush=${e.flushIntervalSeconds}s`
      ), e.enabled && (e.startNewSession(), e.startPeriodicFlush(), e.addVisibilityListener(), e.autoScreenTracking && e.setupAutoScreenTracking());
    } catch {
      e.enabled = !1;
    }
  }
  /** Record a view event. */
  static view(t, r) {
    try {
      if (!e.canRecord()) return;
      const n = e.normalizeName(t);
      if (!n) return;
      const i = r !== void 0 ? e.normalizeField(r, u) : void 0;
      e.session.recordActivity(), e.addEvent({
        type: "view",
        name: n,
        ...i ? { detail: i } : {}
      }), e.debug(
        `view — ${n}${i ? ` detail=${i}` : ""}`
      ), e.checkFlushThreshold();
    } catch {
    }
  }
  /** Record a feature usage event. */
  static feature(t, r) {
    try {
      if (!e.canRecord()) return;
      const n = e.normalizeName(t);
      if (!n) return;
      const i = r !== void 0 ? e.normalizeField(r, u) : void 0;
      e.session.recordActivity();
      const s = e.featureReach.firstUse(n);
      e.addEvent({
        type: "feature",
        name: n,
        ...i ? { detail: i } : {},
        ...s ? { firstUses: 1 } : {}
      }), e.debug(
        `feature — ${n}${i ? ` detail=${i}` : ""}${s ? " (first use)" : ""}`
      ), e.checkFlushThreshold();
    } catch {
    }
  }
  /** Record a funnel step. */
  static funnel(t, r, n) {
    try {
      if (!e.canRecord() || typeof r != "number" || !Number.isInteger(r) || r < 0) return;
      const i = e.normalizeName(t), s = e.normalizeName(n);
      if (!i || !s) return;
      if (!e.funnels.step(i, r)) {
        e.debug(`funnel — ${i}/${s} (duplicate, skipped)`);
        return;
      }
      e.session.recordActivity(), e.addEvent({
        type: "funnel",
        name: i,
        step: s,
        stepIndex: r
      }), e.debug(`funnel — ${i}/${s} step=${r}`), e.checkFlushThreshold();
    } catch {
    }
  }
  /** Record a performance measurement. */
  static performance(t, r, n) {
    try {
      if (!e.canRecord()) return;
      const i = e.normalizeName(t);
      if (!i || typeof r != "number" || r < 0 || n !== void 0 && (typeof n != "number" || n <= 0))
        return;
      e.session.recordActivity(), e.addEvent({
        type: "performance",
        name: i,
        duration: r,
        ...n !== void 0 ? { threshold: n } : {}
      }), e.debug(
        `performance — ${i} duration=${r}s${n !== void 0 ? ` threshold=${n}s` : ""}`
      ), e.checkFlushThreshold();
    } catch {
    }
  }
  static error(t, r, n) {
    const i = r !== void 0 && B.has(r);
    e.recordErrorEvent(
      t,
      i ? G(r) : "error",
      i ? n : n ?? r
    );
  }
  /**
   * Record an info event — something worth counting that the user did not do
   * and that did not go wrong.
   *
   * Counted separately from errors: an info event never contributes to errors
   * per session and never triggers an alert. Report configuration many sessions
   * share (a tier, a unit preference, a fallback path that fired), never
   * anything about the person. Do not share a name between `error()` and
   * `info()`.
   */
  static info(t, r) {
    e.recordErrorEvent(t, "info", r);
  }
  /**
   * Shared path behind `error()` and `info()`: same normalization, PII guard,
   * session-reach marker, depth increment and rollup key. `severity` is already
   * mapped to one of the two stored levels, so the buffer's rollup key collapses
   * one name reported at several legacy severities into a single entry.
   */
  static recordErrorEvent(t, r, n) {
    try {
      if (!e.canRecord()) return;
      const i = e.normalizeName(t);
      if (!i) return;
      const s = n !== void 0 ? e.normalizeField(n, u) : void 0;
      e.session.recordActivity();
      const c = e.errorReach.firstOccurrence(i);
      e.addEvent({
        type: "error",
        name: i,
        severity: r,
        ...s ? { code: s } : {},
        ...c ? { firstOccurrences: 1 } : {}
      }), e.debug(
        `${r} — ${i}${s ? ` code=${s}` : ""}${c ? " (first occurrence)" : ""}`
      ), e.checkFlushThreshold();
    } catch {
    }
  }
  /** Force flush pending events to the ingest endpoint. */
  static async flush() {
    try {
      await e.performFlush(!1);
    } catch {
    }
  }
  /**
   * Toggle event recording. Disabling discards buffered data and drops the
   * session without sending its end; enabling again starts a new session.
   */
  static setEnabled(t) {
    try {
      e.debug(`setEnabled — ${t}`), e.enabled = t, t ? !e.destroyed && e.configured && (e.startNewSession(), e.startPeriodicFlush(), e.addVisibilityListener(), e.autoScreenTracking && e.setupAutoScreenTracking()) : (e.buffer.clear(), e.session.destroy(), e.funnels.clear(), e.featureReach.clear(), e.errorReach.clear(), e.stopPeriodicFlush(), e.removeVisibilityListener(), e.teardownAutoScreenTracking());
    } catch {
    }
  }
  /** End the session, flush remaining events and clean up. Events are dropped until `configure()` is called again. */
  static async destroy() {
    try {
      if (e.destroyed) return;
      e.debug("destroying"), e.destroyed = !0, e.endCurrentSession(), await e.performFlush(!1), e.stopPeriodicFlush(), e.removeVisibilityListener(), e.teardownAutoScreenTracking(), e.screenViewCooldowns.clear(), e.funnels.clear(), e.featureReach.clear(), e.errorReach.clear(), e.session.destroy(), e.configured = !1;
    } catch {
    }
  }
  // ── Private helpers ───────────────────────────────────────────────────
  /**
   * Whether `settings` match the running configuration. `enabled` is compared
   * with the live state, so a configure() after `setEnabled(false)` that asks
   * for recording is a change, not a no-op.
   */
  static matchesRunningSettings(t) {
    return t.apiKey === e.apiKey && t.endpoint === e.endpoint && t.environment === e.environment && t.enabled === e.enabled && t.flushIntervalSeconds === e.flushIntervalSeconds && t.autoScreenTracking === e.autoScreenTracking && t.debugLogging === e.debugLogging && t.suppressWarnings === e.suppressWarnings && t.appVersion === e.appVersion && t.buildNumber === e.buildNumber;
  }
  /**
   * Wind down the running configuration before a changed `configure()` applies.
   *
   * While recording is enabled, the current session's end goes into the
   * current buffer and that buffer is flushed under the current key, endpoint,
   * environment, context and circuit breaker. The flush is not awaited —
   * `configure()` stays synchronous — and it drains the buffer before its first
   * await, so nothing recorded under the new settings can join it. It runs
   * without `keepalive`: the page is still alive, and keepalive's 64 KB
   * in-flight quota is reserved for the page-hide flush. While recording is
   * disabled, nothing is sent: `setEnabled(false)` already discarded the
   * buffer and dropped the session.
   *
   * The flush timer, visibility listener and auto screen tracking are torn
   * down so the new configuration installs its own.
   */
  static retireRunningConfiguration() {
    e.enabled && (e.endCurrentSession(), e.performFlush(!1, e.currentFlushTarget()).catch(() => {
    })), e.stopPeriodicFlush(), e.removeVisibilityListener(), e.teardownAutoScreenTracking();
  }
  /** The running configuration's buffer and send settings, captured now. */
  static currentFlushTarget() {
    return {
      buffer: e.buffer,
      circuitBreaker: e.circuitBreaker,
      apiKey: e.apiKey,
      endpoint: e.endpoint,
      environment: e.environment,
      context: e.context
    };
  }
  static canRecord() {
    return !e.configured && !e.preConfigureWarned && (e.preConfigureWarned = !0, e.warn("event dropped — SDK is not configured (call Trackless.configure() first)")), e.enabled && !e.destroyed && e.configured;
  }
  /**
   * Normalize an event field (name, detail, step, code) into a valid format.
   * Strips PII, lowercases, replaces invalid chars with underscores, and validates.
   * Returns null if the result is empty or matches an abuse pattern.
   */
  static normalizeField(t, r) {
    if (typeof t != "string") return null;
    let n = e.stripPII(t).toLowerCase();
    return n = n.replace(/[^a-z0-9._-]+/g, "_"), n = n.replace(/^[_.]+|[_.]+$/g, ""), n = n.replace(/\.{2,}/g, "."), !n || (n.length > r && (n = n.slice(0, r)), e.UUID_REGEX.test(n) || e.LONG_HEX_REGEX.test(n) || e.LONG_NUMERIC_REGEX.test(n) || e.ALL_HEX_REGEX.test(n)) ? null : n;
  }
  static debug(t) {
    e.debugLogging && console.log(`[Trackless] ${t}`);
  }
  static warn(t) {
    e.suppressWarnings || console.warn(`[Trackless] ${t}`);
  }
  static addEvent(t) {
    !e.buffer.add(t) && !e.bufferFullWarned && (e.bufferFullWarned = !0, e.warn("event buffer full — new events are dropped until the next flush"));
  }
  /**
   * Strip PII patterns (emails, SSNs, phone numbers) from a string,
   * replacing matches with [REDACTED].
   */
  static stripPII(t) {
    let r = t.replace(
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi,
      "[REDACTED]"
    );
    return r = r.replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[REDACTED]"), r = r.replace(/\b\d{9}\b/g, "[REDACTED]"), r = r.replace(/\+?\d[\d\s\-.()]{8,}\d/g, "[REDACTED]"), r;
  }
  static normalizeName(t) {
    const r = e.normalizeField(t, u);
    return r || (e.warn(`event name rejected — ${w}`), e.onError(new Error(`Invalid event name — ${w}`)), null);
  }
  static startNewSession() {
    e.session.start() && (e.addEvent({ type: "session", name: "start" }), e.debug("session started"));
  }
  static endCurrentSession() {
    const t = e.session.end();
    t && (e.funnels.clear(), e.featureReach.clear(), e.errorReach.clear(), e.addEvent({
      type: "session",
      name: "end",
      duration: t.duration,
      stepIndex: t.depth
    }), e.debug(`session ended — duration=${t.duration}s depth=${t.depth}`));
  }
  static checkFlushThreshold() {
    e.buffer.totalSize >= P && e.performFlush(!1).catch(() => {
    });
  }
  /**
   * Drain `target`'s buffer and send it. `target` defaults to the running
   * configuration, captured when the flush starts; every payload of this flush
   * goes out under that capture even if `configure()` changes the key while
   * an earlier payload is in flight. `keepalive` is set only by the page-hide
   * flush, so the request can outlive the page.
   */
  static async performFlush(t, r = e.currentFlushTarget()) {
    const { buffer: n, circuitBreaker: i } = r;
    if (n.isEmpty) return;
    if (!i.canAttempt()) {
      e.debug("flush skipped — circuit breaker open");
      return;
    }
    const s = n.drain(r.environment, r.context).flatMap((c) => e.splitToBodyLimit(c));
    if (s.length !== 0)
      for (const c of s) {
        e.debug(`flush — ${c.events.length} events`);
        try {
          const o = await V(
            r.endpoint,
            r.apiKey,
            c,
            M,
            t
          );
          o.status >= 500 ? (i.recordFailure(), e.warn(`flush failed — status=${o.status}`), e.onError(new Error(`Flush failed with status ${o.status}`))) : o.status >= 400 ? (e.warn(`flush rejected — status=${o.status}`), e.onError(new Error(`Flush rejected with status ${o.status}`))) : (i.recordSuccess(), e.debug(`flush success — status=${o.status}`));
        } catch (o) {
          i.recordFailure(), e.warn("flush failed — network error"), e.onError(o instanceof Error ? o : new Error("Flush failed"));
        }
      }
  }
  /**
   * Split a payload into payloads whose serialized size fits the ingest
   * request body limit. Oversized payloads have their events halved
   * recursively; a single-event payload that still exceeds the limit is
   * dropped with a warning. The wire format is unchanged — only the
   * batching boundaries move.
   */
  static splitToBodyLimit(t) {
    if (e.payloadByteSize(t) <= X) return [t];
    if (t.events.length <= 1)
      return e.warn("event dropped — serialized payload exceeds the request body size limit"), [];
    const r = Math.ceil(t.events.length / 2);
    return [
      ...e.splitToBodyLimit({ ...t, events: t.events.slice(0, r) }),
      ...e.splitToBodyLimit({ ...t, events: t.events.slice(r) })
    ];
  }
  /** UTF-8 byte length of the serialized payload — matches the server-side Content-Length check. */
  static payloadByteSize(t) {
    const r = JSON.stringify(t);
    return typeof TextEncoder > "u" ? r.length : new TextEncoder().encode(r).length;
  }
  static startPeriodicFlush() {
    e.flushTimer === null && (e.flushTimer = setInterval(() => {
      e.performFlush(!1).catch(() => {
      });
    }, e.flushIntervalSeconds * 1e3));
  }
  static stopPeriodicFlush() {
    e.flushTimer !== null && (clearInterval(e.flushTimer), e.flushTimer = null);
  }
  static addVisibilityListener() {
    e.visibilityHandler === null && (typeof document > "u" || (e.visibilityHandler = () => {
      document.visibilityState === "hidden" ? (e.endCurrentSession(), e.performFlush(!0).catch(() => {
      })) : document.visibilityState === "visible" && e.startNewSession();
    }, document.addEventListener("visibilitychange", e.visibilityHandler)));
  }
  static removeVisibilityListener() {
    e.visibilityHandler !== null && (typeof document > "u" || (document.removeEventListener("visibilitychange", e.visibilityHandler), e.visibilityHandler = null));
  }
  static setupAutoScreenTracking() {
    typeof window > "u" || typeof history > "u" || (e.recordScreenView(), e.originalPushState || (e.originalPushState = history.pushState.bind(history), history.pushState = function(...t) {
      e.originalPushState(...t), e.recordScreenView();
    }), e.popstateHandler || (e.popstateHandler = () => {
      e.recordScreenView();
    }, window.addEventListener("popstate", e.popstateHandler)), e.hashchangeHandler || (e.hashchangeHandler = () => {
      e.recordScreenView();
    }, window.addEventListener("hashchange", e.hashchangeHandler)));
  }
  static teardownAutoScreenTracking() {
    typeof window > "u" || (e.originalPushState && (history.pushState = e.originalPushState, e.originalPushState = null), e.popstateHandler && (window.removeEventListener("popstate", e.popstateHandler), e.popstateHandler = null), e.hashchangeHandler && (window.removeEventListener("hashchange", e.hashchangeHandler), e.hashchangeHandler = null));
  }
  static recordScreenView() {
    try {
      if (!e.canRecord()) return;
      const t = typeof window < "u" ? window.location.pathname : "/", r = e.pathToScreenName(t);
      if (!z.test(r)) return;
      const i = (typeof window < "u" ? (window.location.hash ?? "").replace(/^#/, "") : "") || void 0, s = i ? `${r}|${i}` : r, c = Date.now(), o = e.screenViewCooldowns.get(s);
      if (o !== void 0 && c - o < H)
        return;
      e.screenViewCooldowns.set(s, c), e.view(r, i);
    } catch {
    }
  }
  /** Replace dynamic URL segments (UUIDs, long numeric IDs, long hex strings) with `-id-` */
  static stripDynamicSegments(t) {
    return t.map((r) => e.EMBEDDED_UUID_RE.test(r) || e.LONG_NUMERIC_RE.test(r) || e.LONG_HEX_RE.test(r) ? "-id-" : r);
  }
  /** Convert a URL path to a screen name */
  static pathToScreenName(t) {
    const r = t.replace(/^\//, "");
    if (!r) return "home";
    const n = r.split("/").filter(Boolean);
    let s = e.stripDynamicSegments(n).join("_");
    return s = s.replace(/_+/g, "_"), s = s.replace(/_$/, ""), s || "home";
  }
};
e.apiKey = "", e.endpoint = "", e.environment = "production", e.onError = () => {
}, e.flushIntervalSeconds = E, e.autoScreenTracking = !1, e.debugLogging = !1, e.suppressWarnings = !1, e.appVersion = void 0, e.buildNumber = void 0, e.enabled = !1, e.destroyed = !1, e.configured = !1, e.bufferFullWarned = !1, e.preConfigureWarned = !1, e.buffer = new f(), e.circuitBreaker = new p(), e.context = { platform: "web" }, e.session = new g(), e.funnels = new m(), e.featureReach = new v(), e.errorReach = new y(), e.flushTimer = null, e.visibilityHandler = null, e.popstateHandler = null, e.hashchangeHandler = null, e.originalPushState = null, e.screenViewCooldowns = /* @__PURE__ */ new Map(), e.UUID_REGEX = /^[0-9a-f]{8}[-_][0-9a-f]{4}[-_][0-9a-f]{4}[-_][0-9a-f]{4}[-_][0-9a-f]{12}$/, e.LONG_HEX_REGEX = /[0-9a-f]{25,}/, e.LONG_NUMERIC_REGEX = /^[0-9]{13,}$/, e.ALL_HEX_REGEX = /^[0-9a-f]{17,}$/, e.EMBEDDED_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, e.LONG_NUMERIC_RE = /^\d{6,}$/, e.LONG_HEX_RE = /^[0-9a-f]{12,}$/i;
let b = e;
export {
  W as Severity,
  b as Trackless
};
