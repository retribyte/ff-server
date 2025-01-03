import { JwtPayload, sign, verify } from "jsonwebtoken";
import JWT from "jsonwebtoken";

type JWTService = {
    sign: typeof sign;
    verify: typeof verify;
};

export class TokenService {
    private jwtService: JWTService;
    private JWT_SECRET: string;
    private EXPIRATION_TIME: number;

    constructor(jwtService: JWTService = JWT) {
        this.jwtService = jwtService;
        this.JWT_SECRET = process.env.JWT_SECRET || "secret";
        this.EXPIRATION_TIME = process.env.JWT_EXPIRATION
            ? parseInt(process.env.JWT_EXPIRATION)
            : 3600;
    }

    async generateToken(user: any) {
        return this.jwtService.sign({ user }, this.JWT_SECRET, {
            expiresIn: this.EXPIRATION_TIME,
        });
    }

    async checkToken(token: string) {
        try {
            // We're not using the option to return a string here, so we can safely cast the return value to JwtPayload
            return this.jwtService.verify(token, this.JWT_SECRET) as JwtPayload;
        } catch (err) {
            return null;
        }
    }
}
