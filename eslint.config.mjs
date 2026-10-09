import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: [
      "data/**",
      "coverage/**",
      "mediamtx/runtime.yml",
      "test-results/**",
      "playwright-report/**",
      "blob-report/**",
      "tests/e2e/.auth/**",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
];

export default eslintConfig;
