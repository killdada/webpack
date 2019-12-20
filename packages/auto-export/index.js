const chokidar = require("chokidar");

const { parse } = require("@babel/parser");

const fs = require("fs");

const path = require("path");

const traverse = require("@babel/traverse").default;

const t = require("@babel/types");

const _ = require("lodash");

const chalk = require("chalk");

const pluginName = "AutoExport";

const { getFileName, toArray, getFiles } = require("./utils");

class AutoExport {
  constructor(options = {}) {
    if (!_.isObject(options)) {
      console.log(chalk.red("插件接受的参数必须是个对象"));
      options = {};
    } else if (
      options.dir &&
      !(_.isArray(options.dir) || _.isString(options.dir))
    ) {
      options.dir = ".";
      console.log(chalk.red("插件dir参数必须是个数组或者字符串"));
    } else if (options.ignored && !_.isRegExp(options.ignored)) {
      options.ignored = null;
      console.log(chalk.red("插件ignored参数必须是个正则表达式"));
    }

    this.options = options;
    this.isWatching = false; // 是否watch模式

    this.watcher = null;
    this.cacheExportNameMap = {};
    this.compileHasError = false;
    this.currentDirPath = "";
  }

  setCacheExportNameMapData(key, value) {
    const exportDataMap = this.getCacheExportNameMap();
    exportDataMap[key] = value;
  }

  getCacheExportNameMap() {
    // 注意需要先初始化这个对象。不然找不到后续的引用指针改变的都有问题
    if (!this.cacheExportNameMap[this.currentDirPath]) {
      this.cacheExportNameMap[this.currentDirPath] = {};
    }
    return this.cacheExportNameMap[this.currentDirPath];
  }

  deleteCacheExportNameMapData(key) {
    const exportDataMap = this.getCacheExportNameMap();
    delete exportDataMap[key];
  }

  init(stats) {
    this.compileHasError = stats.hasErrors();

    if (this.isWatching && !this.watcher && !this.compileHasError) {
      this.watcher = chokidar.watch(this.options.dir || "src", {
        usePolling: true,
        ignored: this.options.ignored
      });
      this.watcher
        .on("change", _.debounce(this.handleChange.bind(this)(), 0))
        .on("unlink", _.debounce(this.handleChange.bind(this)(true), 0))
        .on("add", _.debounce(this.handleChange.bind(this)(), 0));
    }
  }

  handleChange(isDelete = false) {
    return pathname => {
      if (!this.compileHasError) {
        const absolutePath = path.resolve(pathname);
        if (getFileName(pathname) !== "index") {
          this.handleWriteIndex(absolutePath, isDelete);
        }
      }
    };
  }

  handleWriteIndex(changedFilePath, isDelete) {
    let changedFileName = getFileName(changedFilePath);
    let dirPath = path.dirname(changedFilePath);
    this.currentDirPath = dirPath;

    const exportNameMap = isDelete
      ? {}
      : this.getExportNames(changedFilePath, changedFileName);

    const cacheExportNameMapCopy = _.cloneDeep(this.getCacheExportNameMap());

    if (isDelete || _.isEmpty(exportNameMap)) {
      this.deleteCacheExportNameMapData(changedFilePath);
    } else {
      this.setCacheExportNameMapData(changedFilePath, {
        filename: changedFileName,
        exportData: exportNameMap
      });
    }

    // 缓存的变量改变了，需要重新写index文件
    if (!_.isEqual(cacheExportNameMapCopy, this.getCacheExportNameMap())) {
      this.autoWriteFile(`${dirPath}/index.js`);
    }
  }
  /**
   * 获得所有导出的变量名，
   * getExportNames方法里面需要避免重复，不然写index的时候可能导致变量重复
   * default 这个默认都是用的文件名，因此不会重复
   */
  getAllExportVars() {
    const currentCacheMap = this.getCacheExportNameMap();
    if (_.isEmpty(currentCacheMap)) return {};
    let result = {};
    Object.keys(currentCacheMap).forEach(key => {
      const { exportData } = currentCacheMap[key];
      const { default: defaultExport, ...other } = exportData;
      result = {
        ...result,
        ...other
      };
    });
    return result;
  }

  /**
   *
   * @param {*} changedFilePath 改变的文件的绝对路径
   * @param {*} changedFileName 改变的文件的文件名
   * 返回改变的文件的所有导出的对象，
   * 注意需要和cacheExportNameMap进行对比，避免导出的变量名重复
   * getAllExportVars获得已有的变量名，如果之前已经有这个变量名，现在又有了个新的
   * 直接拼接当前文件名+变量名
   */
  getExportNames(changedFilePath, changedFileName) {
    const ast = this.getAst(changedFilePath);
    let exportNameMap = {};
    let exportVars = this.getAllExportVars();

    const setCacheVars = path => {
      const name = path.node.name;
      // 已经存在这个变量
      if (_.has(exportVars, name)) {
        const camelCaseName = _.camelCase(`${changedFileName} ${name}`);
        exportNameMap[camelCaseName] = camelCaseName;
      } else {
        exportNameMap[name] = name;
      }
    };

    try {
      traverse(ast, {
        // 主要处理export const a = 1这种写法
        ExportNamedDeclaration(path) {
          if (path.get("declaration").isVariableDeclaration()) {
            setCacheVars(path.get("declaration.declarations.0.id"));
          }
        },
        // 处理 export function getOne(){}写法
        FunctionDeclaration(path) {
          if (t.isExportNamedDeclaration(path.parent)) {
            setCacheVars(path.get("id"));
          }
        },
        // 处理const A = 1; export { A }这种写法
        ExportSpecifier(path) {
          setCacheVars(path.get("exported"));
        },
        // 处理export default写法， 如果是export default会用文件名作为变量名
        ExportDefaultDeclaration() {
          exportNameMap.default = changedFileName;
        }
      });
      return exportNameMap;
    } catch (error) {
      throw error;
    }
  }

  /**
   *
   * @param {需要写入的文件绝对路径} writeFilePath
   */
  autoWriteFile(writeFilePath) {
    const currentCacheMap = this.getCacheExportNameMap();
    if (_.isEmpty(currentCacheMap)) return;
    let exportStr = "";

    Object.keys(currentCacheMap).forEach(key => {
      const { filename, exportData } = currentCacheMap[key];
      const { default: defaultExport, ...other } = exportData;
      const noDefaultExportNames = Object.keys(other);
      let otherStr = _.isEmpty(noDefaultExportNames)
        ? ""
        : `, ${noDefaultExportNames.join(", ")}`;
      let defaultStr = defaultExport || "";
      exportStr += `export { ${defaultStr}${otherStr} } from './${filename}'\n`;
    });
    fs.writeFileSync(writeFilePath, `${exportStr}\n`);
  }

  getAst(filename) {
    const content = fs.readFileSync(filename, "utf8");

    try {
      const ast = parse(content, {
        sourceType: "module"
      });
      return ast;
    } catch (error) {
      console.log(error);
      return null;
    }
  }

  watchClose() {
    if (this.watcher) {
      this.watcher.close();
    }
  }

  // emit触发的时候收集一次所以这个目录下面的依赖
  collectCache() {
    const dirArr = toArray(this.options.dir || "src");
    dirArr.forEach(dir => {
      const files = getFiles(path.resolve(dir));
      let dirPath;
      files.forEach(absolutePath => {
        const filename = getFileName(absolutePath);
        dirPath = path.dirname(absolutePath);
        this.currentDirPath = dirPath;
        const exportNameMap = this.getExportNames(absolutePath, filename);
        this.setCacheExportNameMapData(absolutePath, {
          filename,
          exportData: exportNameMap
        });
      });
      this.autoWriteFile(`${dirPath}/index.js`);
    });
  }

  apply(compiler) {
    const init = this.init.bind(this);
    const watchClose = this.watchClose.bind(this);
    const collectCache = this.collectCache.bind(this);

    if (compiler.hooks) {
      compiler.hooks.watchRun.tap(pluginName, () => {
        this.isWatching = true;
      });
      compiler.hooks.emit.tap(pluginName, collectCache);
      compiler.hooks.done.tap(pluginName, init);
      compiler.hooks.watchClose.tap(pluginName, watchClose);
    } else {
      compiler.plugin("watchRun", () => {
        this.isWatching = true;
      });
      compiler.plugin("emit", collectCache);
      compiler.plugin("done", init);
      compiler.plugin("watchClose", watchClose);
    }
  }
}

module.exports = AutoExport;
