class h {
  constructor(t = 1e3) {
    this.aggregated = /* @__PURE__ */ new Map(), this.individual = [], this.maxItems = t;
  }
  /** Add an event to the buffer. Returns true if accepted. */
  add(t) {
    return t.type === "funnel" || t.type === "session" && t.name !== "duration" ? this.totalSize >= this.maxItems ? !1 : (this.individual.push({ ...t }), !0) : t.type === "performance" ? this.addPerformance(t) : this.addCountable(t);
  }
  addCountable(t) {
    const r = this.rollupKey(t), i = this.aggregated.get(r);
    return i ? (i.count = (i.count ?? 1) + (t.count ?? 1), t.firstUses !== void 0 && (i.firstUses = (i.firstUses ?? 0) + t.firstUses), t.firstOccurrences !== void 0 && (i.firstOccurrences = (i.firstOccurrences ?? 0) + t.firstOccurrences), !0) : this.totalSize >= this.maxItems ? !1 : (this.aggregated.set(r, { ...t, count: t.count ?? 1 }), !0);
  }
  addPerformance(t) {
    const r = this.rollupKey(t), i = this.aggregated.get(r);
    if (i)
      return i.durations || (i.durations = []), t.duration !== void 0 ? i.durations.push(t.duration) : t.durations && i.durations.push(...t.durations), delete i.duration, !0;
    if (this.totalSize >= this.maxItems) return !1;
    const n = { ...t };
    return n.duration !== void 0 ? (n.durations = [n.duration], delete n.duration) : n.durations || (n.durations = []), this.aggregated.set(r, n), !0;
  }
  /** Drain the buffer into an EventPayload and clear it. */
  drain(t, r) {
    for (const o of this.aggregated.values())
      o.firstUses !== void 0 && !(o.firstUses >= 1) && delete o.firstUses, o.firstOccurrences !== void 0 && !(o.firstOccurrences >= 1) && delete o.firstOccurrences;
    const i = [...this.aggregated.values(), ...this.individual];
    if (this.aggregated.clear(), this.individual = [], i.length === 0) return [];
    const n = /* @__PURE__ */ new Date(), s = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`, c = [];
    for (let o = 0; o < i.length; o += 100)
      c.push({
        date: s,
        environment: t,
        context: r,
        events: i.slice(o, o + 100)
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
const p = [3e4, 6e4, 3e5, 9e5, 36e5];
class g {
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
    const t = Math.min(this.consecutiveFailures - 1, p.length - 1);
    this.nextRetryAt = Date.now() + p[t];
  }
  /** Current consecutive failure count (for testing) */
  get failures() {
    return this.consecutiveFailures;
  }
}
const b = "0.4.0", $ = {
  version: b
};
function l() {
  return typeof navigator < "u" ? navigator : {};
}
function R(a, t) {
  return {
    platform: "web",
    osVersion: F(),
    deviceClass: A(),
    region: L(),
    language: D(),
    browser: N(),
    os: T(),
    appVersion: a,
    buildNumber: t,
    sdkVersion: `web/${$.version}`,
    distributionChannel: typeof window < "u" ? window.location.hostname : void 0
    // daysSinceInstall omitted — web has no install concept
  };
}
function F() {
  try {
    const a = l().userAgentData;
    if (a != null && a.platformVersion) {
      const s = a.platformVersion.split(".")[0];
      if (s) return s;
    }
    const t = typeof navigator < "u" ? navigator.userAgent : "";
    if (!t) return;
    let r;
    const i = t.match(/Windows NT (\d+\.\d+)/);
    if (i && (r = i[1]), !r) {
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
function A() {
  try {
    if (typeof navigator > "u" || typeof window > "u")
      return;
    const a = navigator.maxTouchPoints > 0, t = window.innerWidth;
    return a && t < 768 ? "phone" : a && t < 1024 ? "tablet" : "desktop";
  } catch {
    return;
  }
}
function L() {
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
function D() {
  var a;
  try {
    const t = ((a = navigator.languages) == null ? void 0 : a[0]) ?? navigator.language;
    if (t) {
      const n = t.split("-")[0].toLowerCase();
      if (n) return n;
    }
    return new Intl.DateTimeFormat().resolvedOptions().locale.split("-")[0].toLowerCase() || void 0;
  } catch {
    return;
  }
}
function N() {
  try {
    const a = l();
    if (a.webdriver) return "bot";
    const t = a.userAgentData;
    if (t != null && t.brands) {
      const r = t.brands.map((i) => i.brand.toLowerCase());
      if (r.some((i) => i.includes("edge") || i.includes("edg"))) return "edge";
      if (r.some((i) => i.includes("firefox"))) return "firefox";
      if (r.some((i) => i.includes("chrome") || i.includes("chromium"))) return "chrome";
    }
    return navigator.vendor === "Apple Computer, Inc." ? "safari" : "other";
  } catch {
    return "other";
  }
}
function T() {
  try {
    const a = l().userAgentData;
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
class m {
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
class w {
  constructor() {
    this.funnels = /* @__PURE__ */ new Map();
  }
  /**
   * Check and record a funnel step for deduplication.
   *
   * @returns true if the step was newly recorded, false if it was a duplicate
   */
  step(t, r) {
    let i = this.funnels.get(t);
    return i || (i = /* @__PURE__ */ new Set(), this.funnels.set(t, i)), i.has(r) ? !1 : (i.add(r), !0);
  }
  /** Clear all funnel state (call on session end). */
  clear() {
    this.funnels.clear();
  }
}
class y {
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
class E {
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
const C = 1e4;
async function O(a, t, r, i = C, n = !1) {
  const s = new AbortController(), c = setTimeout(() => s.abort(), i);
  try {
    const o = await fetch(a, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": t
      },
      body: JSON.stringify(r),
      signal: s.signal,
      keepalive: n
    });
    clearTimeout(c);
    let f;
    try {
      f = await o.json();
    } catch {
    }
    return { status: o.status, body: f };
  } catch (o) {
    throw clearTimeout(c), o;
  }
}
const U = /^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/, u = 100, v = 60, z = 1e4, M = 6e4, I = 100, H = "https://api.tracklesstelemetry.com", V = 50 * 1024, P = {
  DEBUG: "debug",
  INFO: "info",
  WARNING: "warning",
  ERROR: "error",
  FATAL: "fatal"
}, X = new Set(Object.values(P)), d = "error", e = class e {
  /** Whether the SDK has been configured and is ready to record events. */
  static get isConfigured() {
    return e.configured && !e.destroyed;
  }
  /** Configure the SDK and start a new session. */
  static configure(t) {
    try {
      e.apiKey = t.apiKey, e.endpoint = t.endpoint ?? H, e.environment = t.environment ?? "production", e.enabled = t.enabled ?? !0, e.onError = t.onError ?? (() => {
      }), e.flushIntervalSeconds = t.flushIntervalSeconds ?? v, e.autoScreenTracking = t.autoScreenTracking ?? !1, e.debugLogging = t.debugLogging ?? !1, e.suppressWarnings = t.suppressWarnings ?? !1, e.buffer = new h(), e.circuitBreaker = new g(), e.context = R(t.appVersion, t.buildNumber), e.session = new m(), e.funnels = new w(), e.featureReach = new y(), e.errorReach = new E(), e.screenViewCooldowns = /* @__PURE__ */ new Map(), e.bufferFullWarned = !1, e.preConfigureWarned = !1, e.destroyed = !1, e.configured = !0, e.debug(
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
      const i = e.normalizeName(t);
      if (!i) return;
      const n = r !== void 0 ? e.normalizeField(r, u) : void 0;
      e.session.recordActivity(), e.addEvent({
        type: "view",
        name: i,
        ...n ? { detail: n } : {}
      }), e.debug(
        `view — ${i}${n ? ` detail=${n}` : ""}`
      ), e.checkFlushThreshold();
    } catch {
    }
  }
  /** Record a feature usage event. */
  static feature(t, r) {
    try {
      if (!e.canRecord()) return;
      const i = e.normalizeName(t);
      if (!i) return;
      const n = r !== void 0 ? e.normalizeField(r, u) : void 0;
      e.session.recordActivity();
      const s = e.featureReach.firstUse(i);
      e.addEvent({
        type: "feature",
        name: i,
        ...n ? { detail: n } : {},
        ...s ? { firstUses: 1 } : {}
      }), e.debug(
        `feature — ${i}${n ? ` detail=${n}` : ""}${s ? " (first use)" : ""}`
      ), e.checkFlushThreshold();
    } catch {
    }
  }
  /** Record a funnel step. */
  static funnel(t, r, i) {
    try {
      if (!e.canRecord() || typeof r != "number" || !Number.isInteger(r) || r < 0) return;
      const n = e.normalizeName(t), s = e.normalizeName(i);
      if (!n || !s) return;
      if (!e.funnels.step(n, r)) {
        e.debug(`funnel — ${n}/${s} (duplicate, skipped)`);
        return;
      }
      e.session.recordActivity(), e.addEvent({
        type: "funnel",
        name: n,
        step: s,
        stepIndex: r
      }), e.debug(`funnel — ${n}/${s} step=${r}`), e.checkFlushThreshold();
    } catch {
    }
  }
  /** Record a performance measurement. */
  static performance(t, r, i) {
    try {
      if (!e.canRecord()) return;
      const n = e.normalizeName(t);
      if (!n || typeof r != "number" || r < 0 || i !== void 0 && (typeof i != "number" || i <= 0))
        return;
      e.session.recordActivity(), e.addEvent({
        type: "performance",
        name: n,
        duration: r,
        ...i !== void 0 ? { threshold: i } : {}
      }), e.debug(
        `performance — ${n} duration=${r}s${i !== void 0 ? ` threshold=${i}s` : ""}`
      ), e.checkFlushThreshold();
    } catch {
    }
  }
  /** Record an error event. */
  static error(t, r = d, i) {
    try {
      if (!e.canRecord()) return;
      const n = e.normalizeName(t);
      if (!n) return;
      let s = r;
      X.has(r) || (e.warn(
        `invalid error severity "${r}" — falling back to "${d}"`
      ), s = d);
      const c = i !== void 0 ? e.normalizeField(i, u) : void 0;
      e.session.recordActivity();
      const o = e.errorReach.firstOccurrence(n);
      e.addEvent({
        type: "error",
        name: n,
        severity: s,
        ...c ? { code: c } : {},
        ...o ? { firstOccurrences: 1 } : {}
      }), e.debug(
        `error — ${n} severity=${s}${c ? ` code=${c}` : ""}${o ? " (first occurrence)" : ""}`
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
  /** Toggle event recording. Disabling discards buffered data. */
  static setEnabled(t) {
    try {
      e.debug(`setEnabled — ${t}`), e.enabled = t, t ? !e.destroyed && e.configured && (e.startPeriodicFlush(), e.addVisibilityListener(), e.autoScreenTracking && e.setupAutoScreenTracking()) : (e.buffer.clear(), e.stopPeriodicFlush(), e.removeVisibilityListener(), e.teardownAutoScreenTracking());
    } catch {
    }
  }
  /** Flush remaining events and clean up. Permanently disables the instance. */
  static async destroy() {
    try {
      if (e.destroyed) return;
      e.debug("destroying"), e.destroyed = !0, e.endCurrentSession(), await e.performFlush(!1), e.stopPeriodicFlush(), e.removeVisibilityListener(), e.teardownAutoScreenTracking(), e.screenViewCooldowns.clear(), e.funnels.clear(), e.featureReach.clear(), e.errorReach.clear(), e.session.destroy(), e.configured = !1;
    } catch {
    }
  }
  // ── Private helpers ───────────────────────────────────────────────────
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
    let i = e.stripPII(t).toLowerCase();
    return i = i.replace(/[^a-z0-9._-]+/g, "_"), i = i.replace(/^[_.]+|[_.]+$/g, ""), i = i.replace(/\.{2,}/g, "."), !i || (i.length > r && (i = i.slice(0, r)), e.UUID_REGEX.test(i) || e.LONG_HEX_REGEX.test(i) || e.LONG_NUMERIC_REGEX.test(i) || e.ALL_HEX_REGEX.test(i)) ? null : i;
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
    return r || (e.warn(`event name rejected: "${t}"`), e.onError(new Error(`Invalid event name: ${t}`)), null);
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
    e.buffer.totalSize >= I && e.performFlush(!1).catch(() => {
    });
  }
  static async performFlush(t) {
    if (e.buffer.isEmpty) return;
    if (!e.circuitBreaker.canAttempt()) {
      e.debug("flush skipped — circuit breaker open");
      return;
    }
    const r = e.buffer.drain(e.environment, e.context).flatMap((i) => e.splitToBodyLimit(i));
    if (r.length !== 0)
      for (const i of r) {
        e.debug(`flush — ${i.events.length} events`);
        try {
          const n = await O(
            e.endpoint,
            e.apiKey,
            i,
            z,
            t
          );
          n.status >= 500 ? (e.circuitBreaker.recordFailure(), e.warn(`flush failed — status=${n.status}`), e.onError(new Error(`Flush failed with status ${n.status}`))) : n.status >= 400 ? (e.warn(`flush rejected — status=${n.status}`), e.onError(new Error(`Flush rejected with status ${n.status}`))) : (e.circuitBreaker.recordSuccess(), e.debug(`flush success — status=${n.status}`));
        } catch (n) {
          e.circuitBreaker.recordFailure(), e.warn("flush failed — network error"), e.onError(n instanceof Error ? n : new Error("Flush failed"));
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
    if (e.payloadByteSize(t) <= V) return [t];
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
      if (!U.test(r)) return;
      const n = (typeof window < "u" ? (window.location.hash ?? "").replace(/^#/, "") : "") || void 0, s = n ? `${r}|${n}` : r, c = Date.now(), o = e.screenViewCooldowns.get(s);
      if (o !== void 0 && c - o < M)
        return;
      e.screenViewCooldowns.set(s, c), e.view(r, n);
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
    const i = r.split("/").filter(Boolean);
    let s = e.stripDynamicSegments(i).join("_");
    return s = s.replace(/_+/g, "_"), s = s.replace(/_$/, ""), s || "home";
  }
};
e.apiKey = "", e.endpoint = "", e.environment = "production", e.onError = () => {
}, e.flushIntervalSeconds = v, e.autoScreenTracking = !1, e.debugLogging = !1, e.suppressWarnings = !1, e.enabled = !1, e.destroyed = !1, e.configured = !1, e.bufferFullWarned = !1, e.preConfigureWarned = !1, e.buffer = new h(), e.circuitBreaker = new g(), e.context = { platform: "web" }, e.session = new m(), e.funnels = new w(), e.featureReach = new y(), e.errorReach = new E(), e.flushTimer = null, e.visibilityHandler = null, e.popstateHandler = null, e.hashchangeHandler = null, e.originalPushState = null, e.screenViewCooldowns = /* @__PURE__ */ new Map(), e.UUID_REGEX = /^[0-9a-f]{8}[-_][0-9a-f]{4}[-_][0-9a-f]{4}[-_][0-9a-f]{4}[-_][0-9a-f]{12}$/, e.LONG_HEX_REGEX = /[0-9a-f]{25,}/, e.LONG_NUMERIC_REGEX = /^[0-9]{13,}$/, e.ALL_HEX_REGEX = /^[0-9a-f]{17,}$/, e.EMBEDDED_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, e.LONG_NUMERIC_RE = /^\d{6,}$/, e.LONG_HEX_RE = /^[0-9a-f]{12,}$/i;
let S = e;
export {
  P as Severity,
  S as Trackless
};
