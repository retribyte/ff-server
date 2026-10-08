import { PrismaClient, User, UserRole } from "@prisma/client";
export { UserRole };
import { hashSync, compareSync } from "bcryptjs";
import { sanitizeText } from "../utils/sanitize.js";
import booru from "../utils/booru.js";

const prisma = new PrismaClient();

const SALT_ROUNDS = process.env.SALT_ROUNDS ? parseInt(process.env.SALT_ROUNDS) : 12;
const PASSWORD_MIN_LENGTH = process.env.PASSWORD_MIN_LENGTH ? parseInt(process.env.PASSWORD_MIN_LENGTH) : 8;
// bcrypt ignores everything past 72 bytes; refuse rather than silently truncate
const PASSWORD_MAX_BYTES = 72;
const BIO_MAX_LENGTH = 2000;
const WIKI_USER_MAX_LENGTH = 100;

export type SafeUser = Omit<User, "password">;

// What anyone (logged in or not) may see about a user (FR-AUTH-5)
const PUBLIC_SELECT = {
    id: true,
    username: true,
    role: true,
    icon: true,
    iconBooruId: true,
    bio: true,
    wikiUser: true,
    createdAt: true,
} as const;

function toSafe(user: User): SafeUser {
    const { password: _, ...safe } = user;
    return safe;
}

/** Throws when a candidate password breaks the password rules. */
function validatePassword(password: unknown): asserts password is string {
    if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH) {
        throw new Error(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
    }
    if (Buffer.byteLength(password, "utf8") > PASSWORD_MAX_BYTES) {
        throw new Error(`Password must be at most ${PASSWORD_MAX_BYTES} bytes`);
    }
}

async function createUser(
    username: string,
    email: string,
    password: string
): Promise<User> {
    const existingUser = await prisma.user.findUnique({ where: { username } });
    if (existingUser) {
        throw new Error("User already exists");
    }
    validatePassword(password);
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
    bio?: string | null;
    wikiUser?: string | null;
    iconBooruId?: number | null;
};

async function getAllUsers(): Promise<SafeUser[]> {
    const users = await prisma.user.findMany({ orderBy: { id: "asc" } });
    return users.map(toSafe);
}

async function getUserById(id: number): Promise<SafeUser | null> {
    const user = await prisma.user.findUnique({ where: { id } });
    return user ? toSafe(user) : null;
}

/** Public profile by id or username, with the user's characters and stories. */
async function getPublicProfile(idOrUsername: number | string) {
    return await prisma.user.findUnique({
        where: typeof idOrUsername === "number" ? { id: idOrUsername } : { username: idOrUsername },
        select: {
            ...PUBLIC_SELECT,
            characters: {
                select: { id: true, name: true, slug: true, image: true, color: true },
                orderBy: { name: "asc" },
            },
            stories: {
                select: { id: true, slug: true, title: true, publishedDate: true },
                orderBy: { title: "asc" },
            },
            _count: { select: { messages: true, commentaries: true } },
        },
    });
}

function cleanOptionalText(value: unknown, field: string, maxLength: number): string | null {
    if (value === null) return null;
    if (typeof value !== "string") throw new Error(`${field} must be a string`);
    const trimmed = value.trim();
    if (trimmed.length > maxLength) throw new Error(`${field} must be at most ${maxLength} characters`);
    return trimmed || null;
}

async function updateUser(id: number, data: ProfileUpdate): Promise<SafeUser> {
    const update: { bio?: string | null; wikiUser?: string | null; icon?: string | null; iconBooruId?: number | null } = {};

    if (data.bio !== undefined) {
        const bio = cleanOptionalText(data.bio, "Bio", BIO_MAX_LENGTH);
        update.bio = bio ? sanitizeText(bio) : null;
    }
    if (data.wikiUser !== undefined) {
        update.wikiUser = cleanOptionalText(data.wikiUser, "Wiki username", WIKI_USER_MAX_LENGTH);
    }
    if (data.iconBooruId !== undefined) {
        if (data.iconBooruId === null) {
            update.icon = null;
            update.iconBooruId = null;
        } else {
            if (!Number.isInteger(data.iconBooruId) || data.iconBooruId <= 0) {
                throw new Error("Booru ID must be a positive whole number");
            }
            const post = await booru.getBooruPost(data.iconBooruId);
            if (!post) throw new Error(`No booru post with ID ${data.iconBooruId}`);
            update.icon = post.imageUrl;
            update.iconBooruId = post.id;
        }
    }

    const updated = await prisma.user.update({ where: { id }, data: update });
    return toSafe(updated);
}

/**
 * Changes a user's own password. Stamps passwordChangedAt (which invalidates
 * every token issued before now) and clears mustChangePassword.
 */
async function changePassword(id: number, currentPassword: string, newPassword: string): Promise<User> {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new Error("User not found");
    if (!compareSync(currentPassword, user.password)) {
        throw new Error("Current password is incorrect");
    }
    validatePassword(newPassword);
    if (compareSync(newPassword, user.password)) {
        throw new Error("New password must be different from the current one");
    }
    return await prisma.user.update({
        where: { id },
        data: {
            password: hashSync(newPassword, SALT_ROUNDS),
            passwordChangedAt: new Date(),
            mustChangePassword: false,
        },
    });
}

async function updateUserRole(id: number, role: UserRole): Promise<SafeUser> {
    const updated = await prisma.user.update({ where: { id }, data: { role } });
    return toSafe(updated);
}

export default {
    createUser,
    getAllUsers,
    getUserById,
    getPublicProfile,
    getUserByUsername,
    getUserByEmail,
    authenticateUser,
    updateUser,
    changePassword,
    updateUserRole,
};
