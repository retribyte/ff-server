import { PrismaClient, User, UserRole } from "@prisma/client";
import { hashSync, compareSync } from "bcryptjs";

const prisma = new PrismaClient();

const SALT_ROUNDS = process.env.SALT_ROUNDS ? parseInt(process.env.SALT_ROUNDS) : 12;

async function createUser(
    username: string,
    email: string,
    password: string
): Promise<User> {
    const existingUser = await prisma.user.findUnique({ where: { username } });
    if (existingUser) {
        throw new Error("User already exists");
    }
    return await prisma.user.create({
        data: {
            username,
            email,
            password: hashSync(password, SALT_ROUNDS),
            role: UserRole.USER,
        },
    });
}

async function getUserByUsername(username: string): Promise<User | null> {
    return await prisma.user.findUnique({ where: { username } });
}

async function getUserByEmail(email: string): Promise<User | null> {
    return await prisma.user.findUnique({ where: { email } });
}

async function authenticateUser(
    username: string,
    password: string
): Promise<User | null> {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) return null;
    if (!compareSync(password, user.password)) return null;
    return user;
}

export default { createUser, getUserByUsername, getUserByEmail, authenticateUser };
