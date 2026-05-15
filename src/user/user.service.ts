import { PrismaClient, User, UserRole } from "@prisma/client";
export { UserRole };
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

type ProfileUpdate = {
    username?: string;
    icon?: string;
    bio?: string;
};

async function updateUser(id: number, data: ProfileUpdate): Promise<Omit<User, "password">> {
    const updated = await prisma.user.update({
        where: { id },
        data: {
            username: data.username,
            icon: data.icon,
            bio: data.bio,
        },
    });
    const { password: _, ...safe } = updated;
    return safe;
}

async function updateUserRole(id: number, role: UserRole): Promise<Omit<User, "password">> {
    const updated = await prisma.user.update({ where: { id }, data: { role } });
    const { password: _, ...safe } = updated;
    return safe;
}

export default { createUser, getUserByUsername, getUserByEmail, authenticateUser, updateUser, updateUserRole };
