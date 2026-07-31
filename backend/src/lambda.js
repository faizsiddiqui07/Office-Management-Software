import serverless from 'serverless-http';
import { app, initApp } from './app.js';
import { runScheduledJobs } from './services/scheduler.service.js';

/**
 * AWS Lambda entry point (handler = "src/lambda.handler" in the Lambda config).
 * Works behind API Gateway (both HTTP API v2 and REST API v1 — auto-detected by
 * serverless-http). This file is ONLY used on Lambda; local dev keeps using
 * src/index.js, so running locally is unaffected.
 *
 * `binary` is REQUIRED for file downloads: without it serverless-http returns a
 * PDF as a UTF-8 string, which mangles the compressed byte streams — the file
 * downloads but renders as a blank white page. Listing the binary content types
 * makes it base64-encode the body and set isBase64Encoded, so the bytes survive.
 *
 * NOTE: On a REST API (v1) the API Gateway ALSO needs its binaryMediaTypes set to
 * a wildcard (star-slash-star) for this to take effect. HTTP API v2 and Lambda
 * Function URLs honour isBase64Encoded automatically, so no extra config there.
 */
const serverlessHandler = serverless(app, {
  binary: ['application/pdf', 'application/octet-stream', 'application/zip', 'image/*'],
});

export const handler = async (event, context) => {
  // Keep the Mongo connection (and role cache) alive between warm invocations.
  context.callbackWaitsForEmptyEventLoop = false;
  await initApp(); // idempotent + cached

  // Scheduled tick from EventBridge (Scheduler input {"cron": true}, or a classic rule).
  // Run the time-based jobs and return WITHOUT going through Express — there's no HTTP
  // request to route. These frequent ticks also keep this container warm (init already
  // done above), which is what makes the app open instantly for the next real visitor.
  if (event?.cron === true || event?.source === 'aws.events' || event?.source === 'aws.scheduler') {
    const jobs = await runScheduledJobs().catch((e) => ({ error: e?.message || 'error' }));
    return { statusCode: 200, body: JSON.stringify({ ok: true, jobs }) };
  }

  return serverlessHandler(event, context);
};
