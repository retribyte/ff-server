import JWT, { JwtPayload } from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET ?? "secret";
const EXPIRATION_TIME = process.env.JWT_EXPIRATION
    ? parseInt(process.env.JWT_EXPIRATION)
    : 3600;

// The token only identifies the user; authenticate() loads the rest fresh
// from the database on every request.
async function generateAccessToken(user: { id: number; username: string; role: string }): Promise<string> {
    return JWT.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: EXPIRATION_TIME });
}

async function verifyAccessToken(token: string): Promise<JwtPayload | null> {
    try {
        return JWT.verify(token, JWT_SECRET) as JwtPayload;
    } catch {
        return null;
    }
}

export default { generateAccessToken, verifyAccessToken };
