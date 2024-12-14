import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

class App {
    public app: express.Application;
    private prisma: PrismaClient;

    constructor() {
        this.app = express();
        this.prisma = new PrismaClient();
        this.config();
        this.routes();
        this.errorHandlers();
    }

    private config(): void {
        this.app.use(express.json());
        this.app.use(cors());
        this.app.use(express.static(__dirname + "/public"));
    }

    private routes(): void {
        // Routes go here, mmkay?
    }

    private errorHandlers(): void {
        this.app.use(
            (err: Error, req: Request, res: Response, next: NextFunction) => {
                console.error(err.stack);
                res.status(500).send("L, 500 server error");
            }
        );

        this.app.use((req: Request, res: Response, next: NextFunction) => {
            res.status(404).send("Resource not found");
        });
    }

    public listen(port: number): void {
        this.app.listen(port, () => {
            console.log(`Server is running on port ${port}`);
        });
    }
}

export default App;