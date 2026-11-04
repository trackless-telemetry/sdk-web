/**
 * The listeners behind `captureUncaught`: `error` and `unhandledrejection` on
 * `window`.
 *
 * Each uncaught exception is reported as one code — the error's `name`
 * (`TypeError`), or `non_error` for a thrown or rejected value that is not an
 * `Error` — which `Trackless` normalizes and records as the error
 * `trackless.uncaught`. Nothing else is read into an event: never the message,
 * the stack, the file name or the line.
 *
 * Two kinds of `error` event are skipped on purpose:
 * - an opaque cross-origin "Script error.", which carries no error object; and
 * - one whose `filename` belongs to a browser extension, compared in memory
 *   against the extension URL schemes and never sent.
 *
 * The listeners never call `preventDefault()`, so the browser still reports
 * every error to the console. Nothing here throws.
 */

/** URL schemes of browser-extension scripts, whose errors are not the page's. */
const EXTENSION_SCHEMES = [
  "chrome-extension:",
  "moz-extension:",
  "safari-extension:",
  "safari-web-extension:",
];

/** The code sent for a thrown or rejected value that is not an `Error`. */
export const NON_ERROR_CODE = "non_error";

/** Whether `filename` is a browser-extension script. */
export function isExtensionFilename(filename: unknown): boolean {
  if (typeof filename !== "string" || filename === "") return false;
  const lower = filename.toLowerCase();
  return EXTENSION_SCHEMES.some((scheme) => lower.startsWith(scheme));
}

/** Whether `value` is an `Error`, including one from another realm (an iframe). */
function isError(value: unknown): value is Error {
  if (value instanceof Error) return true;
  return Object.prototype.toString.call(value) === "[object Error]";
}

/** The code for one thrown or rejected value: its `name`, or `non_error`. */
export function codeForThrown(value: unknown): string {
  if (!isError(value)) return NON_ERROR_CODE;
  const name = value.name;
  return typeof name === "string" ? name : NON_ERROR_CODE;
}

/**
 * The code for one window `error` event, or null when it is skipped: no error
 * object (an opaque cross-origin error), or a script from a browser extension.
 */
export function codeForErrorEvent(event: ErrorEvent): string | null {
  if (event.error === null || event.error === undefined) return null;
  if (isExtensionFilename(event.filename)) return null;
  return codeForThrown(event.error);
}

/** The code for one `unhandledrejection` event. */
export function codeForRejection(event: PromiseRejectionEvent): string {
  return codeForThrown(event.reason);
}

export class UncaughtListener {
  private errorHandler: ((event: Event) => void) | null = null;
  private rejectionHandler: ((event: Event) => void) | null = null;

  /** Whether the listeners are attached. */
  get isListening(): boolean {
    return this.errorHandler !== null;
  }

  /** Attach both listeners, when not already attached. */
  start(onUncaught: (code: string) => void): void {
    if (this.errorHandler || typeof window === "undefined") return;
    try {
      this.errorHandler = (event) => {
        try {
          const code = codeForErrorEvent(event as ErrorEvent);
          if (code !== null) onUncaught(code);
        } catch {
          // Never throws into the page
        }
      };
      this.rejectionHandler = (event) => {
        try {
          onUncaught(codeForRejection(event as PromiseRejectionEvent));
        } catch {
          // Never throws into the page
        }
      };
      window.addEventListener("error", this.errorHandler);
      window.addEventListener("unhandledrejection", this.rejectionHandler);
    } catch {
      this.stop();
    }
  }

  /** Detach both listeners. */
  stop(): void {
    try {
      if (typeof window !== "undefined") {
        if (this.errorHandler) window.removeEventListener("error", this.errorHandler);
        if (this.rejectionHandler) {
          window.removeEventListener("unhandledrejection", this.rejectionHandler);
        }
      }
    } catch {
      // Never throws
    }
    this.errorHandler = null;
    this.rejectionHandler = null;
  }
}
