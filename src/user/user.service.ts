import { Prisma, PrismaClient } from "@prisma/client";
import { hashSync, compare } from "bcrypt";
import type { User } from "@prisma/client";

export class UserService {
    private prisma: any;
    private bcrypt: any;

    constructor() {
      this.prisma = new PrismaClient();
      this.bcrypt = { hashSync, compare };
    }
  
    async createUser(username: string, email: string, password: string) {
        const saltRounds: number = process.env.SALT_ROUNDS ? parseInt(process.env.SALT_ROUNDS) : 12;
        const encryptedPassword = this.bcrypt.hashSync(password, saltRounds);

        const newUser = await this.prisma.user.upsert({
            where: {
                username,
            },
            update: {
                email,
                password: encryptedPassword,
            },
            create: {
                username,
                email,
                password: encryptedPassword
            },
        })

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

    async authenticateUser(user: any) {
        const foundUser = await this.prisma.user.findUnique({
            where: {
                email: user.email,
            },
        });

        if (foundUser) {
            const isPasswordCorrect = await this.bcrypt.compare(user.password, foundUser.password);

            if (isPasswordCorrect) {
                return foundUser;
            }
        }

        return null;
    }
}