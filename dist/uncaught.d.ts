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
/** The code sent for a thrown or rejected value that is not an `Error`. */
export declare const NON_ERROR_CODE = "non_error";
/** Whether `filename` is a browser-extension script. */
export declare function isExtensionFilename(filename: unknown): boolean;
/** The code for one thrown or rejected value: its `name`, or `non_error`. */
export declare function codeForThrown(value: unknown): string;
/**
 * The code for one window `error` event, or null when it is skipped: no error
 * object (an opaque cross-origin error), or a script from a browser extension.
 */
export declare function codeForErrorEvent(event: ErrorEvent): string | null;
/** The code for one `unhandledrejection` event. */
export declare function codeForRejection(event: PromiseRejectionEvent): string;
export declare class UncaughtListener {
    private errorHandler;
    private rejectionHandler;
    /** Whether the listeners are attached. */
    get isListening(): boolean;
    /** Attach both listeners, when not already attached. */
    start(onUncaught: (code: string) => void): void;
    /** Detach both listeners. */
    stop(): void;
}
