import type {
  EventPayload,
  EventContext,
  TracklessEvent,
  IngestResponse,
  Environment,
  ErrorSeverity,
} from "@trackless/shared-types";

/** SDK configuration options */
export interface TracklessConfig {
  /** API key in tl_* format (required) */
  apiKey: string;
  /** Ingest endpoint URL (default: https://api.tracklesstelemetry.com) */
  endpoint?: string;
  /** Environment tag: 'sandbox' or 'production' (default: 'production') */
  environment?: Environment;
  /** Enable/disable event recording (default: true) */
  enabled?: boolean;
  /** Optional error callback for debugging */
  onError?: (error: Error) => void;
  /** Auto-track screen views via pushState/popstate (default: false) */
  autoScreenTracking?: boolean;
  /** Flush interval in milliseconds (default: 60000) */
  flushIntervalMs?: number;
  /** App version string for context (optional) */
  appVersion?: string;
  /** Build number string for context (optional) */
  buildNumber?: string;
}

/** Result from the HTTP send */
export interface SendResult {
  status: number;
  body?: IngestResponse;
}

// Re-exports from shared types for SDK consumers
export type {
  EventPayload,
  EventContext,
  TracklessEvent,
  IngestResponse,
  Environment,
  ErrorSeverity,
};
