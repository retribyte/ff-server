import { Router } from "express";
import { CharacterService } from "./character.service.js";

export class CharacterController {
    public router: Router;
    private characterService: CharacterService;

    constructor() {
        this.router = Router();
        this.characterService = new CharacterService();
        this.initializeRoutes();
    }

    private initializeRoutes() {
        this.router.post("/characters", this.characterService.createCharacter);
        this.router.get("/characters", this.characterService.getAllCharacters);
        this.router.get(
            "/characters/:id",
            this.characterService.getCharacterById
        );
        this.router.put(
            "/characters/:id",
            this.characterService.updateCharacter
        );
        this.router.delete(
            "/characters/:id",
            this.characterService.deleteCharacter
        );
    }
}
