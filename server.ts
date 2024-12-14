import App from "./src/app";

// Choose the port number to run the app under
const port: number = Number(process.env.PORT) || 3000;

// Create a new app instance, tell it to start listening
const app = new App();
app.listen(port);