import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

// ff-server previously had no linting at all. This is a deliberately light
// flat config: the recommended JS + typescript-eslint rules, with the two
// rules the existing code trips most often (explicit `any` in catch clauses /
// Prisma where-filters, and intentionally-unused vars) downgraded to warnings
// so `npm run lint` is green today and the backlog is visible, not blocking.
export default tseslint.config(
    {
        ignores: ["dist/**", "node_modules/**", "prisma/migrations/**"],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        languageOptions: {
            globals: { ...globals.node },
        },
        rules: {
            "@typescript-eslint/no-explicit-any": "warn",
            "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
        },
    },
);
