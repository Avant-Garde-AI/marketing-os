import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["dist/**", "node_modules/**", "test/.cache/**", "test/__screenshots__/**"] },
  js.configs.recommended,
  // ESLint 8's default (the hosted app lints this source with it): a caught
  // error may go unnamed-in-use — `catch (e) { /* never break the storefront */ }`.
  { rules: { "no-unused-vars": ["error", { caughtErrors: "none" }] } },
  {
    // The runtime ships to storefronts as a classic script: browser globals, ES2017 output.
    files: ["src/**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "script", globals: { ...globals.browser } },
    rules: { "no-empty": ["error", { allowEmptyCatch: true }] },
  },
  {
    files: ["scripts/**/*.mjs", "test/**/*.mjs", "eslint.config.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: { ...globals.node, ...globals.browser } },
  },
];
