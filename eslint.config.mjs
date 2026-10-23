import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      ".tools/**",
      ".data/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  ...nextVitals,
  ...nextTs,
  {
    files: [
      "lib/db/**/*.ts",
      "lib/security/**/*.ts",
      "lib/projects/**/*.ts",
      "lib/settings/**/*.ts",
      "lib/schemas/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["next", "next/*"],
              message:
                "Shared domain modules in lib/ must remain framework-agnostic so the background worker can import them.",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
