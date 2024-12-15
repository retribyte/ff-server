export class TokenService {
    private jwtService: any;
    private JWT_SECRET: string;
    private EXPIRATION_TIME: number;

    constructor(jwtService: any) {
        this.jwtService = jwtService;
        this.JWT_SECRET = process.env.JWT_SECRET || "secret";
        this.EXPIRATION_TIME = process.env.JWT_EXPIRATION ? parseInt(process.env.JWT_EXPIRATION) : 3600;
    }

    async generateToken(user: any) {
        return this.jwtService.sign(
            { user }, 
            this.JWT_SECRET, 
            { expiresIn: this.EXPIRATION_TIME, }
        );
    }

    async checkToken(token: string) {
        try {
            return this.jwtService.verify(token, this.JWT_SECRET);
        } catch (err) {
            return null;
        }
    }
}