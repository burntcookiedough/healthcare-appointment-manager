import { FlatCompat } from "@eslint/eslintrc";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

/** @type {import("eslint").Linter.FlatConfig[]} */
const config = [
  {
    ignores: [".next/**", "node_modules/**", "dist/**", "next-env.d.ts"],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Enforce React exhaustive-deps where practical
      "react-hooks/exhaustive-deps": "warn",
      // Prevent bare `any` in TS without annotation
      "@typescript-eslint/no-explicit-any": "warn",
      // Prevent unused variables (errors already blocked by TS)
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];

export default config;
