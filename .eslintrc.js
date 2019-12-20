module.exports = {
  root: true,
  parserOptions: {
    parser: "babel-eslint"
  },
  env: {
    browser: true,
    es6: true
  },
  plugins: [],
  extends: ["airbnb-base", "plugin:prettier/recommended"],
  rules: {
    "prettier/prettier": "error",
    "no-debugger": process.env.NODE_ENV === "production" ? "error" : "off"
  }
};
