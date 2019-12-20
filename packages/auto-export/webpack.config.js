const path = require("path");
const AutoExport = require("./index");

module.exports = {
  entry: "./entry.js",
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "bundle.js"
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        use: "babel-loader"
      }
    ]
  },
  plugins: [
    new AutoExport({
      dir: ["src", "src1"]
    })
  ]
};
