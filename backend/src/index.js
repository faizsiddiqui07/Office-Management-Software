import { app, initApp } from './app.js';

/**
 * LOCAL server entry point (`npm run dev` / `npm start`). Unchanged behaviour:
 * initialise (DB + roles), then listen on PORT. AWS Lambda uses src/lambda.js
 * instead and never runs this file.
 */
const PORT = Number(process.env.PORT) || 4000;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';

async function start() {
  await initApp();
  app.listen(PORT, () => {
    console.log(`🚀 Server listening on http://localhost:${PORT}`);
    console.log(`   Health:  http://localhost:${PORT}/api/health`);
    console.log(`   CORS origin(s) (credentials): ${CLIENT_URL}`);
  });
}

start();

export { app };
