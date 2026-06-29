import serverless from 'serverless-http';
import { app, initApp } from './app.js';

/**
 * AWS Lambda entry point (handler = "src/lambda.handler" in the Lambda config).
 * Works behind API Gateway (both HTTP API v2 and REST API v1 — auto-detected by
 * serverless-http). This file is ONLY used on Lambda; local dev keeps using
 * src/index.js, so running locally is unaffected.
 */
const serverlessHandler = serverless(app);

export const handler = async (event, context) => {
  // Keep the Mongo connection (and role cache) alive between warm invocations.
  context.callbackWaitsForEmptyEventLoop = false;
  await initApp(); // idempotent + cached
  return serverlessHandler(event, context);
};
