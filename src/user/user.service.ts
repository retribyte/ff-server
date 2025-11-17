import { PrismaClient, UserRole } from "@prisma/client";
import App from "../app.js";
import { compareSync, hashSync } from "bcryptjs";

export class UserService {
    private prisma: PrismaClient;
    private bcrypt: { hashSync: typeof hashSync; compareSync: typeof compareSync };

    constructor() {
        this.prisma = App.prisma;
        this.bcrypt = { hashSync, compareSync };
    }

    async createUser(username: string, email: string, password: string) {
        const saltRounds: number = process.env.SALT_ROUNDS
            ? parseInt(process.env.SALT_ROUNDS)
            : 12;
        const encryptedPassword = this.bcrypt.hashSync(password, saltRounds);

        const existingUser = await this.prisma.user.findUnique({
            where: {
                username,
            },
        });

        if (existingUser) {
            throw new Error("User already exists");
        }

        const newUser = await this.prisma.user.create({
            data: {
                username,
                email,
                password: encryptedPassword,
                role: UserRole.USER,
            },
        });

        return newUser;
    }

    async getUserByEmail(email: string) {
        const user = await this.prisma.user.findUnique({
            where: {
                email: email,
            },
        });

        return user;
    }

    async getUserByUsername(username: string) {
        const user = await this.prisma.user.findUnique({
            where: {
                username: username,
            },
        });

        return user;
    }

    async authenticateUser(user: any) {
        const foundUser = await this.prisma.user.findUnique({
            where: {
                username: user.username,
            },
        });

        if (foundUser) {
            const isPasswordCorrect = await this.bcrypt.compareSync(
                user.password,
                foundUser.password
            );

            if (isPasswordCorrect) {
                return foundUser;
            }
        }

        return null;
    }
}
