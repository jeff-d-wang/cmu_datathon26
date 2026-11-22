import { createApp, analytics, server } from '@databricks/appkit';

// Privacy: no custom request logging, no body logging, no telemetry (DISABLE_APPKIT_INTERNAL_TELEMETRY in app.yaml).
// All ranking and symptom parsing happens in the browser; the server only serves the app and the
// read-only SQL files in config/queries/ (bounding box rounded to 0.5 degrees, state name).
createApp({
  plugins: [analytics(), server()],
}).catch(console.error);
