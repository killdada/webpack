const path = require("path");
const fs = require("fs");

const getFileName = filePath => {
  const ext = path.extname(filePath);
  const fileName = path.basename(filePath, ext);
  return fileName;
};

const toArray = arr => {
  if (Array.isArray(arr)) {
    return arr;
  }
  if (typeof arr === "string") {
    return arr.split(",");
  }
  return [];
};

// 获得目录下所以文件的绝对路径，needIndexFile是否需要返回index.js的绝对路径。默认不需要
const getFiles = (dir, needIndexFile = false) => {
  let result = [];
  try {
    const files = fs.readdirSync(dir);
    files.forEach(item => {
      if (needIndexFile) {
        result.push(path.resolve(dir, item));
      } else if (item !== "index.js") {
        result.push(path.resolve(dir, item));
      }
    });
  } catch (error) {
    //
  }
  return result;
};

module.exports = {
  getFileName,
  toArray,
  getFiles
};
