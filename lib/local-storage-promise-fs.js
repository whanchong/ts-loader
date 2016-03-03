var Promise = window.Promise = require('q').Promise;

var ls = window.localStorage;
var prefix = 'lspfs:';

function Writer(path) {
  this.onwriteend = function () {};
  this.onerror = function () {};
  this.write = function (content) {
    ls.setItem(path, content);
    this.onwriteend();
  };
}

function File(path) {
  this.createWriter = function (cb) {
    cb(new Writer(path))
  };
}

function dir(path) {
  return new Promise(function (resolve, reject) {
    resolve({ nativeURL: path });
  });
}

function dirname(path) {
  return new Promise(function (resolve, reject) {
    resolve();
  });
}

function ensure(path) {
  return new Promise(function (resolve, reject) {
    resolve();
  });
}

function exists(path) {
  return new Promise(function (resolve, reject) {
    resolve(ls.hasOwnProperty(prefix + path));
  });
}

function file(path) {
  return new Promise(function (resolve, reject) {
    resolve(new File(path));
  });
}

function readJSON(path) {
  return new Promise(function (resolve, reject) {
    resolve(JSON.parse(ls.getItem(prefix + path)));
  });
}

module.exports = {
  dir: dir,
  dirname: dirname,
  ensure: ensure,
  exists: exists,
  file: file,
  readJSON: readJSON
};
