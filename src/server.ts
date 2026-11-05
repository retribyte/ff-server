// First import: load .env before any module reads process.env at import time
// (token.service.ts reads JWT_SECRET then, falling back to "secret").
import "dotenv/config";
import App from "./app.js";

// Choose the port number to run the app under
const port: number = Number(process.env.PORT) || 3000;

console.log("Starting server...");

// Create a new app instance, tell it to start listening
const app = new App();
// HOST: 0.0.0.0 by default (Docker); production binds 127.0.0.1 behind its proxy
app.listen(port, process.env.HOST || "0.0.0.0");
