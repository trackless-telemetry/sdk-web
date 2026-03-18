class d {
  constructor(e = 1e3) {
    this.aggregated = /* @__PURE__ */ new Map(), this.individual = [], this.maxItems = e;
  }
  /** Add an event to the buffer. Returns true if accepted. */
  add(e) {
    return e.type === "funnel" || e.type === "session" && e.name !== "duration" ? this.totalSize >= this.maxItems ? !1 : (this.individual.push({ ...e }), !0) : e.type === "performance" ? this.addPerformance(e) : this.addCountable(e);
  }
  addCountable(e) {
    const i = this.rollupKey(e), n = this.aggregated.get(i);
    return n ? (n.count = (n.count ?? 1) + (e.count ?? 1), !0) : this.totalSize >= this.maxItems ? !1 : (this.aggregated.set(i, { ...e, count: e.count ?? 1 }), !0);
  }
  addPerformance(e) {
    const i = this.rollupKey(e), n = this.aggregated.get(i);
    if (n)
      return n.durations || (n.durations = []), e.duration !== void 0 ? n.durations.push(e.duration) : e.durations && n.durations.push(...e.durations), delete n.duration, !0;
    if (this.totalSize >= this.maxItems) return !1;
    const r = { ...e };
    return r.duration !== void 0 ? (r.durations = [r.duration], delete r.duration) : r.durations || (r.durations = []), this.aggregated.set(i, r), !0;
  }
  /** Drain the buffer into an EventPayload and clear it. */
  drain(e, i) {
    const n = [...this.aggregated.values(), ...this.individual];
    if (this.aggregated.clear(), this.individual = [], n.length === 0) return [];
    const r = /* @__PURE__ */ new Date(), a = `${r.getFullYear()}-${String(r.getMonth() + 1).padStart(2, "0")}-${String(r.getDate()).padStart(2, "0")}`, c = [];
    for (let o = 0; o < n.length; o += 100)
      c.push({
        date: a,
        environment: e,
        context: i,
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
  rollupKey(e) {
    switch (e.type) {
      case "feature":
      case "screen":
        return `${e.type}|${e.name}`;
      case "error":
        return `${e.type}|${e.name}|${e.severity ?? ""}|${e.code ?? ""}`;
      case "selection":
        return `${e.type}|${e.name}|${e.option ?? ""}`;
      case "performance":
        return `${e.type}|${e.name}`;
      case "session":
        return `${e.type}|${e.name}`;
      default:
        return `${e.type}|${e.name}`;
    }
  }
}
const l = [3e4, 6e4, 3e5, 9e5, 36e5];
class h {
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
    const e = Math.min(this.consecutiveFailures - 1, l.length - 1);
    this.nextRetryAt = Date.now() + l[e];
  }
  /** Current consecutive failure count (for testing) */
  get failures() {
    return this.consecutiveFailures;
  }
}
function v(s, e) {
  return {
    platform: "web",
    osVersion: S(),
    deviceClass: b(),
    region: E(),
    browser: T(),
    os: $(),
    appVersion: s,
    buildNumber: e
    // daysSinceInstall omitted — web has no install concept
  };
}
function S() {
  try {
    const s = typeof navigator < "u" ? navigator.userAgent : "";
    if (!s) return;
    let e;
    const i = s.match(/Windows NT (\d+\.\d+)/);
    if (i && (e = i[1]), !e) {
      const r = s.match(/Mac OS X (\d+)[_.](\d+)/);
      r && (e = `${r[1]}.${r[2]}`);
    }
    if (!e) {
      const r = s.match(/(?:iPhone|CPU) OS (\d+)[_.](\d+)/);
      r && (e = `${r[1]}.${r[2]}`);
    }
    if (!e) {
      const r = s.match(/Android (\d+(?:\.\d+)?)/);
      if (r) {
        const a = r[1];
        e = a.includes(".") ? a : `${a}.0`;
      }
    }
    if (!e) {
      const r = s.match(/CrOS \S+ (\d+\.\d+)/);
      r && (e = r[1]);
    }
    return (e == null ? void 0 : e.split(".")[0]) || void 0;
  } catch {
    return;
  }
}
function b() {
  try {
    if (typeof navigator > "u" || typeof window > "u")
      return;
    const s = navigator.maxTouchPoints > 0, e = window.innerWidth;
    return s && e < 768 ? "phone" : s && e < 1024 ? "tablet" : "desktop";
  } catch {
    return;
  }
}
function E() {
  var s, e;
  try {
    const i = ((s = navigator.languages) == null ? void 0 : s[0]) ?? navigator.language;
    if (i) {
      const a = i.split("-");
      if (a[1]) return a[1].toUpperCase();
    }
    return (e = new Intl.DateTimeFormat().resolvedOptions().locale.split("-")[1]) == null ? void 0 : e.toUpperCase();
  } catch {
    return;
  }
}
function T() {
  try {
    const s = navigator.userAgentData;
    if (s != null && s.brands) {
      const e = s.brands.map((i) => i.brand.toLowerCase());
      if (e.some((i) => i.includes("edge") || i.includes("edg"))) return "edge";
      if (e.some((i) => i.includes("firefox"))) return "firefox";
      if (e.some((i) => i.includes("chrome") || i.includes("chromium")))
        return "chrome";
    }
    return navigator.vendor === "Apple Computer, Inc." ? "safari" : "other";
  } catch {
    return "other";
  }
}
function $() {
  try {
    const s = navigator.userAgentData;
    if (s != null && s.platform) {
      const i = s.platform.toLowerCase();
      return i === "macos" || i === "mac os x" ? "macos" : i === "windows" ? "windows" : i === "linux" || i.includes("cros") ? "linux" : i === "android" ? "android" : i === "ios" ? "ios" : "other";
    }
    const e = navigator.userAgent;
    return /Mac OS X/.test(e) ? "macos" : /Windows/.test(e) ? "windows" : /Android/.test(e) ? "android" : /iPhone|iPad|iPod/.test(e) ? "ios" : /Linux|CrOS/.test(e) ? "linux" : "other";
  } catch {
    return "other";
  }
}
const f = 1800 * 1e3;
class p {
  constructor() {
    this.startTime = 0, this.depth = 0, this.lastActivityTime = 0, this.active = !1, this.inactivityTimer = null, this.onTimeout = null;
  }
  /** Start a new session. Returns true if a new session was started. */
  start() {
    return this.active && !this.isExpired() ? !1 : (this.startTime = Date.now(), this.depth = 0, this.lastActivityTime = Date.now(), this.active = !0, this.resetInactivityTimer(), !0);
  }
  /** Record activity (non-session event). Increments depth and resets inactivity timer. */
  recordActivity() {
    this.active && (this.depth++, this.lastActivityTime = Date.now(), this.resetInactivityTimer());
  }
  /** End the current session. Returns session duration in seconds and depth, or null if no active session. */
  end() {
    if (!this.active) return null;
    this.active = !1, this.clearInactivityTimer();
    const e = Date.now() - this.startTime;
    return { duration: Math.round(e / 1e3), depth: this.depth };
  }
  /** Check if session has expired due to inactivity. */
  isExpired() {
    return this.active ? Date.now() - this.lastActivityTime >= f : !0;
  }
  /** Whether a session is currently active. */
  get isActive() {
    return this.active && !this.isExpired();
  }
  /** Current session depth. */
  get currentDepth() {
    return this.depth;
  }
  resetInactivityTimer() {
    this.clearInactivityTimer(), this.inactivityTimer = setTimeout(() => {
      this.onTimeout && this.onTimeout();
    }, f);
  }
  clearInactivityTimer() {
    this.inactivityTimer !== null && (clearTimeout(this.inactivityTimer), this.inactivityTimer = null);
  }
  /** Clean up timers. */
  destroy() {
    this.clearInactivityTimer(), this.active = !1;
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
  step(e, i) {
    let n = this.funnels.get(e);
    return n || (n = /* @__PURE__ */ new Set(), this.funnels.set(e, n)), n.has(i) ? !1 : (n.add(i), !0);
  }
  /** Clear all funnel state (call on session end). */
  clear() {
    this.funnels.clear();
  }
}
const A = 1e4;
async function F(s, e, i, n = A, r = !1) {
  const a = new AbortController(), c = setTimeout(() => a.abort(), n);
  try {
    const o = await fetch(s, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": e
      },
      body: JSON.stringify(i),
      signal: a.signal,
      keepalive: r
    });
    clearTimeout(c);
    let u;
    try {
      u = await o.json();
    } catch {
    }
    return { status: o.status, body: u };
  } catch (o) {
    throw clearTimeout(c), o;
  }
}
const g = /^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/, M = 100, y = 6e4, L = 1e4, N = 6e4, C = 100, I = "https://api.tracklesstelemetry.com", t = class t {
  /** Configure the SDK and start a new session. */
  static configure(e) {
    try {
      t.apiKey = e.apiKey, t.endpoint = e.endpoint ?? I, t.environment = e.environment ?? "production", t.enabled = e.enabled ?? !0, t.onError = e.onError ?? (() => {
      }), t.flushIntervalMs = e.flushIntervalMs ?? y, t.autoScreenTracking = e.autoScreenTracking ?? !1, t.debugLogging = e.debugLogging ?? !1, t.buffer = new d(), t.circuitBreaker = new h(), t.context = v(e.appVersion, e.buildNumber), t.session = new p(), t.funnels = new m(), t.screenViewCooldowns = /* @__PURE__ */ new Map(), t.destroyed = !1, t.configured = !0, t.debug(
        `configured — env=${t.environment} endpoint=${t.endpoint} flush=${t.flushIntervalMs}ms`
      ), t.enabled && (t.startNewSession(), t.startPeriodicFlush(), t.addVisibilityListener(), t.autoScreenTracking && t.setupAutoScreenTracking(), t.session.onTimeout = () => {
        t.endCurrentSession(), t.startNewSession();
      });
    } catch {
      t.enabled = !1;
    }
  }
  /** Record a screen view. */
  static screen(e) {
    try {
      if (!t.canRecord()) return;
      const i = t.normalizeName(e);
      if (!i) return;
      t.session.recordActivity(), t.addEvent({ type: "screen", name: i }), t.debug(`screen — ${i}`), t.checkFlushThreshold();
    } catch {
    }
  }
  /** Record a feature usage event. */
  static feature(e) {
    try {
      if (!t.canRecord()) return;
      const i = t.normalizeName(e);
      if (!i) return;
      t.session.recordActivity(), t.addEvent({ type: "feature", name: i }), t.debug(`feature — ${i}`), t.checkFlushThreshold();
    } catch {
    }
  }
  /** Record a funnel step. */
  static funnel(e, i, n) {
    try {
      if (!t.canRecord() || typeof i != "number" || !Number.isInteger(i) || i < 0) return;
      const r = t.normalizeName(e), a = t.normalizeName(n);
      if (!r || !a) return;
      if (!t.funnels.step(r, i)) {
        t.debug(`funnel — ${r}/${a} (duplicate, skipped)`);
        return;
      }
      t.session.recordActivity(), t.addEvent({
        type: "funnel",
        name: r,
        step: a,
        stepIndex: i
      }), t.debug(`funnel — ${r}/${a} step=${i}`), t.checkFlushThreshold();
    } catch {
    }
  }
  /** Record a selection event (e.g., theme preference, language choice). */
  static selection(e, i) {
    try {
      if (!t.canRecord()) return;
      const n = t.normalizeName(e);
      if (!n || !i) return;
      t.session.recordActivity(), t.addEvent({ type: "selection", name: n, option: i }), t.debug(`selection — ${n} option=${i}`), t.checkFlushThreshold();
    } catch {
    }
  }
  /** Record a performance measurement. */
  static performance(e, i) {
    try {
      if (!t.canRecord()) return;
      const n = t.normalizeName(e);
      if (!n || typeof i != "number" || i < 0) return;
      t.session.recordActivity(), t.addEvent({ type: "performance", name: n, duration: i }), t.debug(`performance — ${n} duration=${i}ms`), t.checkFlushThreshold();
    } catch {
    }
  }
  /** Record an error event. */
  static error(e, i = "error", n) {
    try {
      if (!t.canRecord()) return;
      const r = t.normalizeName(e);
      if (!r) return;
      t.session.recordActivity(), t.addEvent({
        type: "error",
        name: r,
        severity: i,
        ...n ? { code: n } : {}
      }), t.debug(`error — ${r} severity=${i}${n ? ` code=${n}` : ""}`), t.checkFlushThreshold();
    } catch {
    }
  }
  /** Force flush pending events to the ingest endpoint. */
  static async flush() {
    try {
      await t.performFlush(!1);
    } catch {
    }
  }
  /** Toggle event recording. Disabling discards buffered data. */
  static setEnabled(e) {
    try {
      t.debug(`setEnabled — ${e}`), t.enabled = e, e ? !t.destroyed && t.configured && (t.startPeriodicFlush(), t.addVisibilityListener(), t.autoScreenTracking && t.setupAutoScreenTracking()) : (t.buffer.clear(), t.stopPeriodicFlush(), t.removeVisibilityListener(), t.teardownAutoScreenTracking());
    } catch {
    }
  }
  /** Flush remaining events and clean up. Permanently disables the instance. */
  static async destroy() {
    try {
      if (t.destroyed) return;
      t.debug("destroying"), t.destroyed = !0, t.endCurrentSession(), await t.performFlush(!1), t.stopPeriodicFlush(), t.removeVisibilityListener(), t.teardownAutoScreenTracking(), t.screenViewCooldowns.clear(), t.funnels.clear(), t.session.destroy(), t.configured = !1;
    } catch {
    }
  }
  // ── Private helpers ───────────────────────────────────────────────────
  static canRecord() {
    return t.enabled && !t.destroyed && t.configured;
  }
  static debug(e) {
    t.debugLogging && console.log(`[Trackless] ${e}`);
  }
  static debugWarn(e) {
    t.debugLogging && console.warn(`[Trackless] ${e}`);
  }
  static addEvent(e) {
    t.buffer.add(e);
  }
  static normalizeName(e) {
    if (typeof e != "string") return null;
    const i = e.toLowerCase();
    return !i || i.length > M ? null : g.test(i) ? i : (t.debugWarn(`invalid event name rejected: "${e}"`), t.onError(new Error(`Invalid event name: ${e}`)), null);
  }
  static startNewSession() {
    t.session.start() && (t.addEvent({ type: "session", name: "start" }), t.debug("session started"));
  }
  static endCurrentSession() {
    const e = t.session.end();
    e && (t.funnels.clear(), t.addEvent({
      type: "session",
      name: "end",
      duration: e.duration,
      stepIndex: e.depth
    }), t.debug(`session ended — duration=${e.duration}s depth=${e.depth}`));
  }
  static checkFlushThreshold() {
    t.buffer.totalSize >= C && t.performFlush(!1).catch(() => {
    });
  }
  static async performFlush(e) {
    if (t.buffer.isEmpty) return;
    if (!t.circuitBreaker.canAttempt()) {
      t.debug("flush skipped — circuit breaker open");
      return;
    }
    const i = t.buffer.drain(t.environment, t.context);
    if (i.length !== 0)
      for (const n of i) {
        t.debug(`flush — ${n.events.length} events`);
        try {
          const r = await F(
            t.endpoint,
            t.apiKey,
            n,
            L,
            e
          );
          r.status >= 500 ? (t.circuitBreaker.recordFailure(), t.debugWarn(`flush failed — status=${r.status}`), t.onError(new Error(`Flush failed with status ${r.status}`))) : r.status >= 400 ? (t.debugWarn(`flush rejected — status=${r.status}`), t.onError(new Error(`Flush rejected with status ${r.status}`))) : (t.circuitBreaker.recordSuccess(), t.debug(`flush success — status=${r.status}`));
        } catch (r) {
          t.circuitBreaker.recordFailure(), t.debugWarn("flush failed — network error"), t.onError(r instanceof Error ? r : new Error("Flush failed"));
        }
      }
  }
  static startPeriodicFlush() {
    t.flushTimer === null && (t.flushTimer = setInterval(() => {
      t.performFlush(!1).catch(() => {
      });
    }, t.flushIntervalMs));
  }
  static stopPeriodicFlush() {
    t.flushTimer !== null && (clearInterval(t.flushTimer), t.flushTimer = null);
  }
  static addVisibilityListener() {
    t.visibilityHandler === null && (typeof document > "u" || (t.visibilityHandler = () => {
      document.visibilityState === "hidden" ? (t.endCurrentSession(), t.performFlush(!0).catch(() => {
      })) : document.visibilityState === "visible" && t.startNewSession();
    }, document.addEventListener("visibilitychange", t.visibilityHandler)));
  }
  static removeVisibilityListener() {
    t.visibilityHandler !== null && (typeof document > "u" || (document.removeEventListener("visibilitychange", t.visibilityHandler), t.visibilityHandler = null));
  }
  static setupAutoScreenTracking() {
    typeof window > "u" || typeof history > "u" || (t.recordScreenView(), t.originalPushState || (t.originalPushState = history.pushState.bind(history), history.pushState = function(...e) {
      t.originalPushState(...e), t.recordScreenView();
    }), t.popstateHandler || (t.popstateHandler = () => {
      t.recordScreenView();
    }, window.addEventListener("popstate", t.popstateHandler)));
  }
  static teardownAutoScreenTracking() {
    typeof window > "u" || (t.originalPushState && (history.pushState = t.originalPushState, t.originalPushState = null), t.popstateHandler && (window.removeEventListener("popstate", t.popstateHandler), t.popstateHandler = null));
  }
  static recordScreenView() {
    try {
      if (!t.canRecord()) return;
      const e = typeof window < "u" ? window.location.pathname : "/", i = t.pathToScreenName(e);
      if (!g.test(i)) return;
      const n = Date.now(), r = t.screenViewCooldowns.get(i);
      if (r !== void 0 && n - r < N)
        return;
      t.screenViewCooldowns.set(i, n), t.screen(i);
    } catch {
    }
  }
  /** Convert a URL path to a screen name */
  static pathToScreenName(e) {
    let i = e.replace(/^\//, "");
    return i ? (i = i.replace(/\//g, "_"), i = i.replace(/_+/g, "_"), i = i.replace(/_$/, ""), i) : "home";
  }
};
t.apiKey = "", t.endpoint = "", t.environment = "production", t.onError = () => {
}, t.flushIntervalMs = y, t.autoScreenTracking = !1, t.debugLogging = !1, t.enabled = !1, t.destroyed = !1, t.configured = !1, t.buffer = new d(), t.circuitBreaker = new h(), t.context = { platform: "web" }, t.session = new p(), t.funnels = new m(), t.flushTimer = null, t.visibilityHandler = null, t.popstateHandler = null, t.originalPushState = null, t.screenViewCooldowns = /* @__PURE__ */ new Map();
let w = t;
export {
  w as Trackless
};
