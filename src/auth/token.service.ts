import JWT, { JwtPayload } from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET ?? "secret";
const EXPIRATION_TIME = process.env.JWT_EXPIRATION
    ? parseInt(process.env.JWT_EXPIRATION)
    : 3600;

async function generateAccessToken(user: any): Promise<string> {
    const { password: _, ...safeUser } = user;
    return JWT.sign(safeUser, JWT_SECRET, { expiresIn: EXPIRATION_TIME });
}

async function verifyAccessToken(token: string): Promise<JwtPayload | null> {
    try {
        return JWT.verify(token, JWT_SECRET) as JwtPayload;
    } catch {
        return null;
    }
}

export default { generateAccessToken, verifyAccessToken };
