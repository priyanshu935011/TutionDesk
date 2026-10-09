import * as Sentry from "@sentry/node";
import { PostHog } from "posthog-node";

let posthogClient = null;
let isSentryInitialized = false;

export const initTelemetry = () => {
  const sentryDsn = process.env.SENTRY_DSN;
  if (sentryDsn) {
    try {
      Sentry.init({
        dsn: sentryDsn,
        environment: process.env.NODE_ENV || "development",
        tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || "0.2"),
      });
      isSentryInitialized = true;
      console.log("✅ Sentry telemetry initialized on Backend");
    } catch (err) {
      console.error("⚠️ Failed to initialize Sentry on Backend:", err.message);
    }
  } else {
    console.log("ℹ️ SENTRY_DSN not provided. Sentry telemetry disabled.");
  }

  const posthogApiKey = process.env.POSTHOG_API_KEY || process.env.POSTHOG_KEY;
  const posthogHost = process.env.POSTHOG_HOST || "https://us.i.posthog.com";

  if (posthogApiKey) {
    try {
      posthogClient = new PostHog(posthogApiKey, { host: posthogHost });
      console.log("✅ PostHog telemetry initialized on Backend");
    } catch (err) {
      console.error("⚠️ Failed to initialize PostHog on Backend:", err.message);
    }
  } else {
    console.log("ℹ️ POSTHOG_API_KEY not provided. PostHog telemetry disabled.");
  }
};

export const captureException = (error, context = {}) => {
  if (isSentryInitialized) {
    try {
      Sentry.withScope((scope) => {
        if (context.user) scope.setUser(context.user);
        if (context.extra) scope.setExtras(context.extra);
        if (context.tags) scope.setTags(context.tags);
        Sentry.captureException(error);
      });
    } catch (err) {
      console.error("Sentry capture exception error:", err.message);
    }
  }

  if (posthogClient) {
    try {
      const distinctId = context.user?.id || context.distinctId || "backend_system";
      posthogClient.capture({
        distinctId: String(distinctId),
        event: "backend_exception",
        properties: {
          errorMessage: error?.message || String(error),
          errorStack: error?.stack,
          ...context.extra,
        },
      });
    } catch (phErr) {
      console.error("PostHog capture exception error:", phErr.message);
    }
  }
};

export const captureEvent = (eventName, properties = {}, userId = "backend_system") => {
  if (posthogClient) {
    try {
      posthogClient.capture({
        distinctId: String(userId),
        event: eventName,
        properties,
      });
    } catch (phErr) {
      console.error("PostHog capture event error:", phErr.message);
    }
  }
};

export const getPostHogClient = () => posthogClient;
