import express, { Application, NextFunction, Request, Response } from "express";
import userController from "./user/user.controller.js";
import characterController from "./character/character.controller.js";

class App {
    public app: Application;

    constructor() {
        this.app = express();
        this.app.use(express.json());
        this.routes();
        this.errorHandlers();
    }

    private routes(): void {
        this.app.use("/api", userController.initializeUserRoutes());
        this.app.use("/api", characterController.initializeCharacterRoutes());
    }

    private errorHandlers(): void {
        this.app.use(
            (err: Error, req: Request, res: Response, next: NextFunction) => {
                console.error(err.stack);
                res.status(500).send("L, 500 server error");
            }
        );

        this.app.use((req: Request, res: Response) => {
            res.status(404).send("Resource not found");
        });
    }

    public listen(port: number, host: string = "0.0.0.0"): void {
        this.app.listen(port, host, () => {
            console.log(`Server is running on port ${port}`);
        });
    }
}

export default App;
