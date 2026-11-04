class g {
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
    const s = { ...t };
    return s.duration !== void 0 ? (s.durations = [s.duration], delete s.duration) : s.durations || (s.durations = []), this.aggregated.set(r, s), !0;
  }
  /** Drain the buffer into an EventPayload and clear it. */
  drain(t, r) {
    for (const o of this.aggregated.values())
      o.firstUses !== void 0 && !(o.firstUses >= 1) && delete o.firstUses, o.firstOccurrences !== void 0 && !(o.firstOccurrences >= 1) && delete o.firstOccurrences;
    const n = [...this.aggregated.values(), ...this.individual];
    if (this.aggregated.clear(), this.individual = [], n.length === 0) return [];
    const s = /* @__PURE__ */ new Date(), a = `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, "0")}-${String(s.getDate()).padStart(2, "0")}`, c = [];
    for (let o = 0; o < n.length; o += 100)
      c.push({
        date: a,
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
const m = [3e4, 6e4, 3e5, 9e5, 36e5];
class y {
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
    const t = Math.min(this.consecutiveFailures - 1, m.length - 1);
    this.nextRetryAt = Date.now() + m[t];
  }
  /** Current consecutive failure count (for testing) */
  get failures() {
    return this.consecutiveFailures;
  }
}
const C = "0.6.0", I = {
  version: C
};
function h() {
  return typeof navigator < "u" ? navigator : {};
}
function O(i, t) {
  return {
    platform: "web",
    osVersion: P(),
    deviceClass: D(),
    region: V(),
    language: x(),
    browser: W(),
    os: X(),
    appVersion: i,
    buildNumber: t,
    sdkVersion: `web/${I.version}`
    // No install-age or distribution-channel field: the SDKs read no install
    // metadata, and the page hostname is never sent.
  };
}
const M = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
function U(i) {
  if (typeof i != "string" || i === "") return !1;
  const t = i.toLowerCase().replace(/\.$/, "");
  if (t === "localhost" || t.endsWith(".localhost") || t === "[::1]" || t === "::1" || t === "0.0.0.0") return !0;
  const r = M.exec(t);
  return r !== null && r.slice(1).every((n) => Number(n) <= 255);
}
function z() {
  var i;
  try {
    return typeof window > "u" ? "production" : U((i = window.location) == null ? void 0 : i.hostname) ? "sandbox" : "production";
  } catch {
    return "production";
  }
}
function P() {
  try {
    const i = h().userAgentData;
    if (i != null && i.platformVersion) {
      const a = i.platformVersion.split(".")[0];
      if (a) return a;
    }
    const t = typeof navigator < "u" ? navigator.userAgent : "";
    if (!t) return;
    let r;
    const n = t.match(/Windows NT (\d+\.\d+)/);
    if (n && (r = n[1]), !r) {
      const a = t.match(/(?:iPhone|CPU) OS (\d+)[_.](\d+)/);
      a && (r = `${a[1]}.${a[2]}`);
    }
    if (!r) {
      const a = t.match(/Android (\d+(?:\.\d+)?)/);
      if (a) {
        const c = a[1];
        r = c.includes(".") ? c : `${c}.0`;
      }
    }
    if (!r) {
      const a = t.match(/CrOS \S+ (\d+\.\d+)/);
      a && (r = a[1]);
    }
    return (r == null ? void 0 : r.split(".")[0]) || void 0;
  } catch {
    return;
  }
}
function D() {
  try {
    if (typeof navigator > "u" || typeof window > "u")
      return;
    const i = navigator.maxTouchPoints > 0, t = window.innerWidth;
    return i && t < 768 ? "phone" : i && t < 1024 ? "tablet" : "desktop";
  } catch {
    return;
  }
}
function V() {
  var i, t;
  try {
    const r = ((i = navigator.languages) == null ? void 0 : i[0]) ?? navigator.language;
    if (r) {
      const a = r.split("-");
      if (a[1]) return a[1].toUpperCase();
    }
    return (t = new Intl.DateTimeFormat().resolvedOptions().locale.split("-")[1]) == null ? void 0 : t.toUpperCase();
  } catch {
    return;
  }
}
function x() {
  var i;
  try {
    const t = ((i = navigator.languages) == null ? void 0 : i[0]) ?? navigator.language;
    if (t) {
      const s = t.split("-")[0].toLowerCase();
      if (s) return s;
    }
    return new Intl.DateTimeFormat().resolvedOptions().locale.split("-")[0].toLowerCase() || void 0;
  } catch {
    return;
  }
}
function W() {
  try {
    const i = h();
    if (i.webdriver) return "bot";
    const t = i.userAgentData;
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
function X() {
  try {
    const i = h().userAgentData;
    if (i != null && i.platform) {
      const r = i.platform.toLowerCase();
      return r === "macos" || r === "mac os x" ? "macos" : r === "windows" ? "windows" : r === "linux" || r.includes("cros") ? "linux" : r === "android" ? "android" : r === "ios" ? "ios" : "other";
    }
    const t = navigator.userAgent;
    return /iPhone|iPad|iPod/.test(t) ? "ios" : /Mac OS X/.test(t) ? "macos" : /Windows/.test(t) ? "windows" : /Android/.test(t) ? "android" : /Linux|CrOS/.test(t) ? "linux" : "other";
  } catch {
    return "other";
  }
}
class v {
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
class E {
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
class w {
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
class b {
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
const T = 50, d = 86400;
function B() {
  return typeof performance < "u" && typeof performance.now == "function" ? performance.now() : Date.now();
}
class G {
  /** @param clock Millisecond clock — injectable for testing. */
  constructor(t = B) {
    this.clock = t, this.open = /* @__PURE__ */ new Map(), this.sequence = 0, this.discardedThrough = 0, this.warnedCap = !1;
  }
  /** Start (or restart) the timer for an already-normalized name. */
  start(t) {
    const r = this.open.has(t);
    if (!r && this.open.size >= T) {
      const n = !this.warnedCap;
      return this.warnedCap = !0, { capReached: !0, shouldWarn: n };
    }
    return this.open.set(t, { atMs: this.clock(), sequence: ++this.sequence }), r ? "restarted" : "started";
  }
  /** Close the timer for an already-normalized name; its elapsed seconds, or null when none is open. */
  stop(t) {
    const r = this.open.get(t);
    return r ? (this.open.delete(t), (this.clock() - r.atMs) / 1e3) : null;
  }
  /** Drop the timer for an already-normalized name, if one is open. */
  cancel(t) {
    this.open.delete(t);
  }
  /** Start one `measure()` call. It does not enter the map or count toward the cap. */
  mark() {
    return { atMs: this.clock(), sequence: ++this.sequence };
  }
  /** Elapsed seconds since `start`, or null when a discard has happened since. */
  elapsedSince(t) {
    return t.sequence <= this.discardedThrough ? null : (this.clock() - t.atMs) / 1e3;
  }
  /** Discard every open timer and invalidate every `measure()` in progress. */
  discardAll() {
    this.discardedThrough = this.sequence, this.open.clear(), this.warnedCap = !1;
  }
  /** Number of open timers. */
  get size() {
    return this.open.size;
  }
}
const j = 60;
function f() {
  if (typeof performance > "u" || typeof performance.getEntriesByType != "function")
    return null;
  const i = performance.getEntriesByType("navigation")[0];
  return i && typeof i.loadEventStart == "number" ? i : null;
}
function k() {
  return typeof document < "u" && document.prerendering === !0;
}
function S() {
  return typeof document < "u" && document.visibilityState === "hidden";
}
function K() {
  try {
    const i = typeof PerformanceObserver < "u" ? PerformanceObserver.supportedEntryTypes : void 0;
    return Array.isArray(i) && i.includes("visibility-state");
  } catch {
    return !1;
  }
}
function q(i) {
  try {
    return performance.getEntriesByType(
      "visibility-state"
    ).some((r) => r.name === "hidden" && r.startTime <= i);
  } catch {
    return !1;
  }
}
function R() {
  const i = f();
  return !i || !(i.loadEventStart > 0) ? null : (i.loadEventStart - i.startTime) / 1e3;
}
function Y(i) {
  return Number.isFinite(i) && i >= 0 && i <= j;
}
class Z {
  constructor() {
    this.armed = !1, this.loadHandler = null, this.visibilityHandler = null;
  }
  /**
   * Measure the launch and hand it to `onMeasured`, now when `load` has
   * already fired, or when it fires. Does nothing after the first call,
   * where there is no navigation entry, or for a launch the rules above skip.
   */
  arm(t) {
    if (this.armed || (this.armed = !0, k())) return;
    const r = K();
    if (!r && S()) return;
    const n = () => {
      const s = f();
      if (!s || !(s.loadEventStart > 0) || typeof s.activationStart == "number" && s.activationStart > 0 || r && q(s.loadEventStart)) return;
      const a = (s.loadEventStart - s.startTime) / 1e3;
      Y(a) && t(a);
    };
    if (R() !== null) {
      n();
      return;
    }
    typeof window > "u" || !f() || (!r && typeof document < "u" && (this.visibilityHandler = () => {
      S() && this.stopListening();
    }, document.addEventListener("visibilitychange", this.visibilityHandler)), this.loadHandler = () => {
      if (this.stopListening(), R() !== null) {
        n();
        return;
      }
      setTimeout(n, 0);
    }, window.addEventListener("load", this.loadHandler, { once: !0 }));
  }
  /** Remove the `load` and `visibilitychange` listeners, if any. */
  stopListening() {
    this.loadHandler && typeof window < "u" && window.removeEventListener("load", this.loadHandler), this.visibilityHandler && typeof document < "u" && document.removeEventListener("visibilitychange", this.visibilityHandler), this.loadHandler = null, this.visibilityHandler = null;
  }
  /** Whether `arm()` has run. */
  get isArmed() {
    return this.armed;
  }
  /** Whether a `load` listener is waiting. */
  get isWaiting() {
    return this.loadHandler !== null;
  }
}
const J = 250;
function Q() {
  try {
    return typeof PerformanceObserver < "u" && Array.isArray(PerformanceObserver.supportedEntryTypes) && PerformanceObserver.supportedEntryTypes.includes("longtask");
  } catch {
    return !1;
  }
}
class _ {
  constructor() {
    this.observer = null;
  }
  /** Start observing, when supported and not already running. */
  start(t) {
    if (!(this.observer || !Q()))
      try {
        const r = new PerformanceObserver((n) => {
          try {
            for (const s of n.getEntries())
              s.duration >= J && t(s.duration / 1e3);
          } catch {
          }
        });
        r.observe({ type: "longtask", buffered: !1 }), this.observer = r;
      } catch {
        this.observer = null;
      }
  }
  /** Stop observing. */
  stop() {
    if (this.observer) {
      try {
        this.observer.disconnect();
      } catch {
      }
      this.observer = null;
    }
  }
  /** Whether the observer is running. */
  get isRunning() {
    return this.observer !== null;
  }
}
const ee = [
  "chrome-extension:",
  "moz-extension:",
  "safari-extension:",
  "safari-web-extension:"
], A = "non_error";
function te(i) {
  if (typeof i != "string" || i === "") return !1;
  const t = i.toLowerCase();
  return ee.some((r) => t.startsWith(r));
}
function re(i) {
  return i instanceof Error ? !0 : Object.prototype.toString.call(i) === "[object Error]";
}
function N(i) {
  if (!re(i)) return A;
  const t = i.name;
  return typeof t == "string" ? t : A;
}
function ne(i) {
  return i.error === null || i.error === void 0 || te(i.filename) ? null : N(i.error);
}
function ie(i) {
  return N(i.reason);
}
class se {
  constructor() {
    this.errorHandler = null, this.rejectionHandler = null;
  }
  /** Whether the listeners are attached. */
  get isListening() {
    return this.errorHandler !== null;
  }
  /** Attach both listeners, when not already attached. */
  start(t) {
    if (!(this.errorHandler || typeof window > "u"))
      try {
        this.errorHandler = (r) => {
          try {
            const n = ne(r);
            n !== null && t(n);
          } catch {
          }
        }, this.rejectionHandler = (r) => {
          try {
            t(ie(r));
          } catch {
          }
        }, window.addEventListener("error", this.errorHandler), window.addEventListener("unhandledrejection", this.rejectionHandler);
      } catch {
        this.stop();
      }
  }
  /** Detach both listeners. */
  stop() {
    try {
      typeof window < "u" && (this.errorHandler && window.removeEventListener("error", this.errorHandler), this.rejectionHandler && window.removeEventListener("unhandledrejection", this.rejectionHandler));
    } catch {
    }
    this.errorHandler = null, this.rejectionHandler = null;
  }
}
const ae = 1e4;
async function oe(i, t, r, n = ae, s = !1) {
  const a = new AbortController(), c = setTimeout(() => a.abort(), n);
  try {
    const o = await fetch(i, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": t
      },
      body: JSON.stringify(r),
      signal: a.signal,
      keepalive: s
    });
    clearTimeout(c);
    let p;
    try {
      p = await o.json();
    } catch {
    }
    return { status: o.status, body: p };
  } catch (o) {
    throw clearTimeout(c), o;
  }
}
const ce = /^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/, u = 100, F = "it normalized to an empty or disallowed value (raw name omitted: it may contain PII)", L = 60, ue = 1e4, de = 6e4, le = 100, fe = "https://api.tracklesstelemetry.com", H = "trackless.", he = "trackless.launch", pe = "trackless.hang", ge = "trackless.uncaught", me = "unknown", l = String.raw`\u00A1-\u167F\u1681-\u1FFF\u200B-\u2027\u202A-\u202E\u2030-\u205E\u2060-\u2FFF\u3001-\uFEFE\uFF00-\u{10FFFF}`, ye = new RegExp(
  String.raw`[A-Za-z0-9._%+\-${l}]{1,64}@[A-Za-z0-9.\-${l}]{1,255}\.[A-Za-z${l}]{2,}`,
  "gu"
), ve = 50 * 1024, Ee = {
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
}, we = new Set(Object.values(Ee));
function be(i) {
  return i === "info" || i === "debug" ? "info" : "error";
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
        endpoint: t.endpoint ?? fe,
        environment: t.environment ?? z(),
        enabled: t.enabled ?? !0,
        flushIntervalSeconds: t.flushIntervalSeconds ?? L,
        autoScreenTracking: t.autoScreenTracking ?? !1,
        debugLogging: t.debugLogging ?? !1,
        suppressWarnings: t.suppressWarnings ?? !1,
        appVersion: t.appVersion,
        buildNumber: t.buildNumber,
        measureLaunch: t.measureLaunch ?? !1,
        launchThresholdSeconds: e.validThreshold(t.launchThresholdSeconds),
        detectHangs: t.detectHangs ?? !1,
        captureUncaught: t.captureUncaught ?? !1
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
      }), e.flushIntervalSeconds = r.flushIntervalSeconds, e.autoScreenTracking = r.autoScreenTracking, e.debugLogging = r.debugLogging, e.suppressWarnings = r.suppressWarnings, e.appVersion = r.appVersion, e.buildNumber = r.buildNumber, e.measureLaunch = r.measureLaunch, e.launchThresholdSeconds = r.launchThresholdSeconds, e.detectHangs = r.detectHangs, e.captureUncaught = r.captureUncaught, e.buffer = new g(), e.circuitBreaker = new y(), e.context = O(r.appVersion, r.buildNumber), e.session = new v(), e.funnels = new E(), e.featureReach = new w(), e.errorReach = new b(), e.screenViewCooldowns = /* @__PURE__ */ new Map(), e.bufferFullWarned = !1, e.preConfigureWarned = !1, e.destroyed = !1, e.configured = !0, n && e.debug(
        "reconfigured — previous session ended and flushed under the previous settings"
      ), e.debug(
        `configured — env=${e.environment} endpoint=${e.endpoint} flush=${e.flushIntervalSeconds}s`
      ), t.launchThresholdSeconds !== void 0 && r.launchThresholdSeconds === void 0 && e.warn(
        "launchThresholdSeconds is not a positive number — trackless.launch is sent without a threshold"
      ), e.enabled && (e.startNewSession(), e.startPeriodicFlush(), e.addVisibilityListener(), e.autoScreenTracking && e.setupAutoScreenTracking(), e.startHangsIfVisible(), e.startUncaughtIfWanted()), r.measureLaunch && e.launch.arm((s) => e.deliverLaunch(s));
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
      const s = r !== void 0 ? e.normalizeField(r, u) : void 0;
      e.session.recordActivity(), e.addEvent({
        type: "view",
        name: n,
        ...s ? { detail: s } : {}
      }), e.debug(
        `view — ${n}${s ? ` detail=${s}` : ""}`
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
      const s = r !== void 0 ? e.normalizeField(r, u) : void 0;
      e.session.recordActivity();
      const a = e.featureReach.firstUse(n);
      e.addEvent({
        type: "feature",
        name: n,
        ...s ? { detail: s } : {},
        ...a ? { firstUses: 1 } : {}
      }), e.debug(
        `feature — ${n}${s ? ` detail=${s}` : ""}${a ? " (first use)" : ""}`
      ), e.checkFlushThreshold();
    } catch {
    }
  }
  /** Record a funnel step. */
  static funnel(t, r, n) {
    try {
      if (!e.canRecord() || typeof r != "number" || !Number.isInteger(r) || r < 0) return;
      const s = e.normalizeName(t), a = e.normalizeName(n);
      if (!s || !a) return;
      if (!e.funnels.step(s, r)) {
        e.debug(`funnel — ${s}/${a} (duplicate, skipped)`);
        return;
      }
      e.session.recordActivity(), e.addEvent({
        type: "funnel",
        name: s,
        step: a,
        stepIndex: r
      }), e.debug(`funnel — ${s}/${a} step=${r}`), e.checkFlushThreshold();
    } catch {
    }
  }
  /**
   * Record a performance measurement.
   *
   * Names starting with `trackless.` are reserved for the metrics the SDK
   * measures itself (`trackless.launch`, `trackless.hang`). Passing one logs a
   * warning once per page load; the measurement is still sent.
   */
  static performance(t, r, n) {
    try {
      if (!e.canRecord()) return;
      const s = e.normalizeName(t);
      if (!s || (e.warnIfReserved(s), typeof r != "number" || r < 0) || n !== void 0 && (typeof n != "number" || n <= 0))
        return;
      e.session.recordActivity(), e.addEvent({
        type: "performance",
        name: s,
        duration: r,
        ...n !== void 0 ? { threshold: n } : {}
      }), e.debug(
        `performance — ${s} duration=${r}s${n !== void 0 ? ` threshold=${n}s` : ""}`
      ), e.checkFlushThreshold();
    } catch {
    }
  }
  /**
   * Start a timer for a performance measurement.
   *
   * The name is normalized here, exactly as `performance()` normalizes its
   * name, so `stopTimer("Checkout")` closes `startTimer("checkout")`. A name
   * normalization rejects is ignored with the usual warning. Starting a name
   * that is already open restarts it. At most 50 timers are open at once; a
   * start past that is ignored, with one warning per session.
   *
   * Open timers live in memory only. **Session end discards every open
   * timer** — the session ends when the page is hidden — as do
   * `setEnabled(false)`, a `configure()` with changed settings and
   * `destroy()`, so a timer never measures time the page spent hidden.
   * Elapsed time comes from `performance.now()`.
   */
  static startTimer(t) {
    try {
      const r = e.normalizeName(t);
      if (!r) return;
      e.warnIfReserved(r);
      const n = e.timers.start(r);
      typeof n == "object" && n.shouldWarn && e.warn(
        `timer "${r}" not started — ${T} timers are already open (logged once per session)`
      );
    } catch {
    }
  }
  /**
   * Stop the timer `name` and send its elapsed time, in seconds, as
   * `performance(name, elapsed, thresholdSeconds)`.
   *
   * Does nothing when no timer of that name is open: never started, already
   * stopped or cancelled, or discarded when the session ended. An elapsed time
   * below zero or above a day is dropped.
   */
  static stopTimer(t, r) {
    try {
      const n = e.normalizeField(t, u);
      if (!n) return;
      const s = e.timers.stop(n);
      if (s === null) return;
      e.recordTimer(n, s, r);
    } catch {
    }
  }
  /**
   * Drop the timer `name` without sending anything — the operation was
   * abandoned, or failed in a way its duration should not describe.
   */
  static cancelTimer(t) {
    try {
      const r = e.normalizeField(t, u);
      r && e.timers.cancel(r);
    } catch {
    }
  }
  static measure(t, r, n) {
    let s = null;
    try {
      s = e.timers.mark();
    } catch {
    }
    const a = r();
    return e.isThenable(a) ? Promise.resolve(a).then((c) => (e.finishMeasure(t, s, n), c)) : (e.finishMeasure(t, s, n), a);
  }
  static error(t, r, n) {
    const s = r !== void 0 && we.has(r);
    e.recordErrorEvent(
      t,
      s ? be(r) : "error",
      s ? n : n ?? r
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
   * Shared path behind `error()`, `info()` and `captureUncaught`: same
   * normalization, PII guard, session-reach marker and rollup key. `severity` is
   * already mapped to one of the two stored levels, so the buffer's rollup key
   * collapses one name reported at several legacy severities into a single
   * entry. A developer's call (`fromSdk` false) warns on a reserved name and
   * counts toward the session's depth; the SDK's own send does neither.
   */
  static recordErrorEvent(t, r, n, s = !1) {
    try {
      if (!e.canRecord()) return;
      const a = e.normalizeName(t);
      if (!a) return;
      const c = n !== void 0 ? e.normalizeField(n, u) : void 0;
      s || (e.warnIfReserved(a, r), e.session.recordActivity());
      const o = e.errorReach.firstOccurrence(a);
      e.addEvent({
        type: "error",
        name: a,
        severity: r,
        ...c ? { code: c } : {},
        ...o ? { firstOccurrences: 1 } : {}
      }), e.debug(
        `${r} — ${a}${c ? ` code=${c}` : ""}${o ? " (first occurrence)" : ""}`
      ), e.checkFlushThreshold();
    } catch {
    }
  }
  static isThenable(t) {
    return t !== null && (typeof t == "object" || typeof t == "function") && typeof t.then == "function";
  }
  /** Send the measurement for one `measure()` call whose `fn` finished normally. */
  static finishMeasure(t, r, n) {
    try {
      if (!r) return;
      const s = e.timers.elapsedSince(r);
      if (s === null) return;
      const a = e.normalizeName(t);
      if (!a) return;
      e.warnIfReserved(a), e.recordTimer(a, s, n);
    } catch {
    }
  }
  /**
   * The send behind `stopTimer()` and `measure()`: `performance()` with an
   * elapsed time the SDK measured, under a name that is already normalized.
   */
  static recordTimer(t, r, n) {
    if (e.canRecord()) {
      if (!(r >= 0 && r <= d)) {
        e.warn(
          `dropped performance "${t}" — timer elapsed time ${r}s is outside 0–${d}s`
        );
        return;
      }
      n !== void 0 && (typeof n != "number" || n <= 0) || (e.session.recordActivity(), e.addEvent({
        type: "performance",
        name: t,
        duration: r,
        ...n !== void 0 ? { threshold: n } : {}
      }), e.debug(
        `performance — ${t} duration=${r}s${n !== void 0 ? ` threshold=${n}s` : ""} (timer)`
      ), e.checkFlushThreshold());
    }
  }
  /**
   * Warn once per page load when a developer's normalized name has the
   * reserved prefix. `kind` names the call in the message.
   */
  static warnIfReserved(t, r = "performance") {
    !t.startsWith(H) || e.reservedPrefixWarned || (e.reservedPrefixWarned = !0, e.warn(
      `${r} name "${t}" starts with "${H}", which is reserved for names the SDK sends itself — sent anyway (logged once)`
    ));
  }
  /** A positive, finite threshold, or undefined. */
  static validThreshold(t) {
    return typeof t == "number" && Number.isFinite(t) && t > 0 ? t : void 0;
  }
  /** Recording, without the pre-configure warning `canRecord()` logs. */
  static isRecording() {
    return e.enabled && !e.destroyed && e.configured;
  }
  /**
   * Send the launch time the probe measured — only while recording with
   * `measureLaunch` on. A launch measured while recording is disabled, or
   * after a reconfigure turned the option off, is dropped.
   */
  static deliverLaunch(t) {
    try {
      if (!e.isRecording() || !e.measureLaunch) return;
      e.recordSdkMetric(he, t, e.launchThresholdSeconds);
    } catch {
    }
  }
  /** Start the long-task observer when `detectHangs` is on and the page is visible. */
  static startHangsIfVisible() {
    e.detectHangs && (typeof document < "u" && document.visibilityState === "hidden" || e.hangs.start((t) => {
      e.isRecording() && e.detectHangs && e.recordSdkMetric(pe, t, void 0);
    }));
  }
  /**
   * Attach the `captureUncaught` listeners when the option is on. Each
   * uncaught error or rejection is recorded as `error("trackless.uncaught",
   * <name>)`; a name normalization rejects is sent as `unknown`.
   */
  static startUncaughtIfWanted() {
    e.captureUncaught && e.uncaught.start((t) => {
      if (!e.isRecording() || !e.captureUncaught) return;
      const r = e.normalizeField(t, u) ?? me;
      e.recordErrorEvent(ge, "error", r, !0);
    });
  }
  /**
   * Buffer one metric the SDK measured itself. Same bounds as a timer; no
   * reserved-name warning, and no session activity — it describes the page,
   * not anything the user did.
   */
  static recordSdkMetric(t, r, n) {
    if (!(r >= 0 && r <= d)) {
      e.warn(
        `dropped performance "${t}" — measured ${r}s is outside 0–${d}s`
      );
      return;
    }
    e.addEvent({
      type: "performance",
      name: t,
      duration: r,
      ...n !== void 0 ? { threshold: n } : {}
    }), e.debug(
      `performance — ${t} duration=${r}s${n !== void 0 ? ` threshold=${n}s` : ""} (SDK)`
    ), e.checkFlushThreshold();
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
      e.debug(`setEnabled — ${t}`), e.enabled = t, t ? !e.destroyed && e.configured && (e.startNewSession(), e.startPeriodicFlush(), e.addVisibilityListener(), e.autoScreenTracking && e.setupAutoScreenTracking(), e.startHangsIfVisible(), e.startUncaughtIfWanted()) : (e.timers.discardAll(), e.buffer.clear(), e.session.destroy(), e.funnels.clear(), e.featureReach.clear(), e.errorReach.clear(), e.stopPeriodicFlush(), e.removeVisibilityListener(), e.teardownAutoScreenTracking(), e.hangs.stop(), e.uncaught.stop());
    } catch {
    }
  }
  /** End the session, flush remaining events and clean up. Events are dropped until `configure()` is called again. */
  static async destroy() {
    try {
      if (e.destroyed) return;
      e.debug("destroying"), e.destroyed = !0, e.endCurrentSession(), await e.performFlush(!1), e.stopPeriodicFlush(), e.removeVisibilityListener(), e.teardownAutoScreenTracking(), e.hangs.stop(), e.uncaught.stop(), e.screenViewCooldowns.clear(), e.funnels.clear(), e.featureReach.clear(), e.errorReach.clear(), e.session.destroy(), e.configured = !1;
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
    return t.apiKey === e.apiKey && t.endpoint === e.endpoint && t.environment === e.environment && t.enabled === e.enabled && t.flushIntervalSeconds === e.flushIntervalSeconds && t.autoScreenTracking === e.autoScreenTracking && t.debugLogging === e.debugLogging && t.suppressWarnings === e.suppressWarnings && t.appVersion === e.appVersion && t.buildNumber === e.buildNumber && t.measureLaunch === e.measureLaunch && t.launchThresholdSeconds === e.launchThresholdSeconds && t.detectHangs === e.detectHangs && t.captureUncaught === e.captureUncaught;
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
    e.timers.discardAll(), e.enabled && (e.endCurrentSession(), e.performFlush(!1, e.currentFlushTarget()).catch(() => {
    })), e.stopPeriodicFlush(), e.removeVisibilityListener(), e.teardownAutoScreenTracking(), e.hangs.stop(), e.uncaught.stop();
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
   *
   * The abuse patterns run on the whole value before the PII strip as well as on
   * the result: the phone pattern eats runs of digits inside a UUID or hex ID, and
   * truncating can cut one short, either of which leaves a part no rule matches.
   */
  static normalizeField(t, r) {
    if (typeof t != "string" || e.isAbusePattern(e.sanitizeField(t))) return null;
    let n = e.sanitizeField(e.stripPII(t));
    return n ? (n.length > r && (n = n.slice(0, r).replace(/[_.]+$/, "")), e.isAbusePattern(n) ? null : n) : null;
  }
  /** Lowercases and reduces a value to the characters and shape a field allows. */
  static sanitizeField(t) {
    return t.toLowerCase().replace(/[^a-z0-9._-]+/g, "_").replace(/^[_.]+|[_.]+$/g, "").replace(/\.{2,}/g, ".");
  }
  /** True when a sanitized field looks like an identifier and must not be sent. */
  static isAbusePattern(t) {
    return e.UUID_REGEX.test(t) || e.LONG_HEX_REGEX.test(t) || e.LONG_NUMERIC_REGEX.test(t) || e.ALL_HEX_REGEX.test(t) || e.hasRedactedIdResidue(t);
  }
  /** The PII marker beside 8+ characters of hex-only tokens: what remains of an ID. */
  static hasRedactedIdResidue(t) {
    if (!t.includes("redacted")) return !1;
    let r = 0;
    for (const n of t.split(/redacted|[-_.]+/))
      /^[0-9a-f]+$/.test(n) && (r += n.length);
    return r >= 8;
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
   *
   * Swift and Kotlin spell out what `\b` means in the SSN patterns, ASCII letters, digits and
   * `_`, because their regex engines do not agree with it. Those patterns stay without the `u`
   * flag, and nothing here uses lookbehind: it is a syntax error before Safari 16.4 and the SDK
   * would not load.
   */
  static stripPII(t) {
    let r = t.includes("@") ? t.replace(ye, "[REDACTED]") : t;
    return r = r.replace(/\b[0-9]{3}-[0-9]{2}-[0-9]{4}\b/g, "[REDACTED]"), r = r.replace(/\b[0-9]{9}\b/g, "[REDACTED]"), r = r.replace(
      // eslint-disable-next-line no-control-regex -- \x0B: the one spelling all four engines read as a vertical tab
      /\+?[0-9][0-9\t\n\x0B\f\r \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF\-.()]{8,}[0-9]/g,
      "[REDACTED]"
    ), r;
  }
  static normalizeName(t) {
    const r = e.normalizeField(t, u);
    return r || (e.warn(`event name rejected — ${F}`), e.onError(new Error(`Invalid event name — ${F}`)), null);
  }
  static startNewSession() {
    e.session.start() && (e.addEvent({ type: "session", name: "start" }), e.debug("session started"));
  }
  static endCurrentSession() {
    e.timers.discardAll();
    const t = e.session.end();
    t && (e.funnels.clear(), e.featureReach.clear(), e.errorReach.clear(), e.addEvent({
      type: "session",
      name: "end",
      duration: t.duration,
      stepIndex: t.depth
    }), e.debug(`session ended — duration=${t.duration}s depth=${t.depth}`));
  }
  static checkFlushThreshold() {
    e.buffer.totalSize >= le && e.performFlush(!1).catch(() => {
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
    const { buffer: n, circuitBreaker: s } = r;
    if (n.isEmpty) return;
    if (!s.canAttempt()) {
      e.debug("flush skipped — circuit breaker open");
      return;
    }
    const a = n.drain(r.environment, r.context).flatMap((c) => e.splitToBodyLimit(c));
    if (a.length !== 0)
      for (const c of a) {
        e.debug(`flush — ${c.events.length} events`);
        try {
          const o = await oe(
            r.endpoint,
            r.apiKey,
            c,
            ue,
            t
          );
          o.status >= 500 ? (s.recordFailure(), e.warn(`flush failed — status=${o.status}`), e.onError(new Error(`Flush failed with status ${o.status}`))) : o.status >= 400 ? (e.warn(`flush rejected — status=${o.status}`), e.onError(new Error(`Flush rejected with status ${o.status}`))) : (s.recordSuccess(), e.debug(`flush success — status=${o.status}`));
        } catch (o) {
          s.recordFailure(), e.warn("flush failed — network error"), e.onError(o instanceof Error ? o : new Error("Flush failed"));
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
    if (e.payloadByteSize(t) <= ve) return [t];
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
      document.visibilityState === "hidden" ? (e.hangs.stop(), e.endCurrentSession(), e.performFlush(!0).catch(() => {
      })) : document.visibilityState === "visible" && (e.startNewSession(), e.startHangsIfVisible());
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
      if (!ce.test(r)) return;
      const n = typeof window < "u" ? (window.location.hash ?? "").replace(/^#/, "") : "", s = e.isPlainAnchor(n) ? n : void 0, a = s ? `${r}|${s}` : r, c = Date.now(), o = e.screenViewCooldowns.get(a);
      if (o !== void 0 && c - o < de)
        return;
      e.screenViewCooldowns.set(a, c), e.view(r, s);
    } catch {
    }
  }
  /**
   * Whether a URL hash reads as a section anchor. Browsers never send a hash to a
   * server, so it is where sign-in tokens, share keys and recovery links go, and the
   * SDK must not be what sends one. The shape is an allowlist because a left-out hash
   * costs little: the view still counts on its bare name, under that name's cooldown.
   */
  static isPlainAnchor(t) {
    return t.length <= e.ANCHOR_MAX_LENGTH && e.ANCHOR_RE.test(t);
  }
  /**
   * Replace dynamic URL segments with `-id-`: anything the abuse patterns would
   * reject, so `/users/user-<uuid>/profile` is still counted as a view, plus the
   * shorter numeric and hex IDs below.
   */
  static stripDynamicSegments(t) {
    return t.map((r) => e.isAbusePattern(r.toLowerCase()) || e.LONG_NUMERIC_RE.test(r) || e.LONG_HEX_RE.test(r) ? "-id-" : r);
  }
  /** Convert a URL path to a screen name */
  static pathToScreenName(t) {
    const r = t.replace(/^\//, "");
    if (!r) return "home";
    const n = r.split("/").filter(Boolean);
    let a = e.stripDynamicSegments(n).join("_");
    return a = a.replace(/_+/g, "_"), a = a.replace(/_$/, ""), a || "home";
  }
};
e.apiKey = "", e.endpoint = "", e.environment = "production", e.onError = () => {
}, e.flushIntervalSeconds = L, e.autoScreenTracking = !1, e.debugLogging = !1, e.suppressWarnings = !1, e.appVersion = void 0, e.buildNumber = void 0, e.measureLaunch = !1, e.launchThresholdSeconds = void 0, e.detectHangs = !1, e.captureUncaught = !1, e.enabled = !1, e.destroyed = !1, e.configured = !1, e.bufferFullWarned = !1, e.preConfigureWarned = !1, e.buffer = new g(), e.circuitBreaker = new y(), e.context = { platform: "web" }, e.session = new v(), e.funnels = new E(), e.featureReach = new w(), e.errorReach = new b(), e.timers = new G(), e.launch = new Z(), e.hangs = new _(), e.uncaught = new se(), e.reservedPrefixWarned = !1, e.flushTimer = null, e.visibilityHandler = null, e.popstateHandler = null, e.hashchangeHandler = null, e.originalPushState = null, e.screenViewCooldowns = /* @__PURE__ */ new Map(), e.UUID_REGEX = /[0-9a-f]{8}[-_.]+[0-9a-f]{4}[-_.]+[0-9a-f]{4}[-_.]+[0-9a-f]{4}/, e.LONG_HEX_REGEX = /[0-9a-f]{24,}/, e.LONG_NUMERIC_REGEX = /^[0-9]{13,}$/, e.ALL_HEX_REGEX = /^[0-9a-f]{17,}$/, e.LONG_NUMERIC_RE = /^\d{6,}$/, e.LONG_HEX_RE = /^[0-9a-f]{12,}$/i, e.ANCHOR_RE = /^[a-z]{1,20}[0-9]{0,3}(?:[-_](?:[a-z]{1,20}[0-9]{0,3}|[0-9]{1,4}))*$/, e.ANCHOR_MAX_LENGTH = 64;
let $ = e;
export {
  Ee as Severity,
  $ as Trackless
};
