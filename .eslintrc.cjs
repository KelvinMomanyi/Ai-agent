/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: { jsx: true },
  },
  env: { browser: true, commonjs: true, es6: true },
  ignorePatterns: ["!**/.server", "!**/.client"],
  extends: ["eslint:recommended", "prettier"],
  overrides: [
    {
      files: ["**/*.{js,jsx,ts,tsx}"],
      plugins: ["react", "jsx-a11y"],
      extends: [
        "plugin:react/recommended",
        "plugin:react/jsx-runtime",
        "plugin:react-hooks/recommended",
        "plugin:jsx-a11y/recommended",
      ],
      settings: {
        react: { version: "detect" },
        formComponents: ["Form"],
        linkComponents: [{ name: "Link", linkAttribute: "to" }],
      },
    },
    {
      files: ["**/*.{ts,tsx}"],
      parser: "@typescript-eslint/parser",
      plugins: ["@typescript-eslint", "import"],
      extends: [
        "plugin:@typescript-eslint/recommended",
        "plugin:import/recommended",
        "plugin:import/typescript",
      ],
      settings: {
        "import/resolver": { typescript: { alwaysTryTypes: true } },
      },
      rules: {
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/no-unused-vars": [
          "warn",
          { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
        ],
      },
    },
    {
      files: [
        ".eslintrc.cjs",
        "vite.config.{js,ts}",
        "**/*.server.{js,ts}",
      ],
      env: { node: true },
    },
  ],
  globals: { shopify: "readonly" },
};
