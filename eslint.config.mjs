import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  globalIgnores([".next/**", "out/**", "build/**", "node_modules/**"]),
  {
    // XSS guard rails: React escapes everything it renders unless one of these is
    // used, so they are errors, not warnings. scripts/check-sinks.mjs covers the
    // DOM APIs ESLint has no rule for.
    rules: {
      "react/no-danger": "error",
      "react/no-danger-with-children": "error",
      "react/jsx-no-script-url": "error",
      "no-script-url": "error",
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
    },
  },
]);
