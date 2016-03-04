var EventEmitter = require('events').EventEmitter;
var all = require('q').all;
var Promise = window.Promise = require('q').Promise;
var throat = require('throat')(Promise);
var SparkMD5 = require('spark-md5');

var config = require('json!../package.json');
var semver = require('semver');
var fs = require('./local-storage-promise-fs');

var localDirectory = ''; // 'dist/';
var totalBytes, loadedBytes;

function retrieveServerAddress() {
  return new Promise(function (resolve, reject) {
    resolve(config.server);
  });

  return window.plugins.appPreferences.fetch('appServer').then(function (server) {
    return server;
  }, function (error) {
    console.error(error);
  });
}

function retrieveRemoteManifest(serverAddress) {
  var url = serverAddress + '/' + config.manifestFile + '?' + Date.now();

  return xhrPromise(url, 'text').then(function (xhr) {
    try {
      manifest = JSON.parse(xhr.response);
    } catch (e) {
      console.error('error parsing the remote manifest', xhr.response);
      throw e;
    }

    console.log('retrieved the manifest.');

    if (!semver.satisfies(manifest.appVersion, config.supportedTSEmberVersion)) {
      throw 'Invalid TableSolution app version: expected \'' + config.supportedTSEmberVersion + '\' and got \'' + manifest.version + '\'.'
    }

    if (!semver.satisfies(manifest.manifestVersion, config.supportedManifestVersion)) {
      throw 'Your application version is too low. Please go on the store and update your application.'
    }

    return manifest;
  });
}

function setupDirectories() {
  console.log('setup directories');
  return fs.dir().then(function (directoryEntry) { return directoryEntry.nativeURL; });
}

function areManifestFilesEqual(file1, file2) {
  return file1.path === file2.path;
}

function checkForFileUpdate() {
  console.log('check for files update');

  return new Promise(function (resolve, reject) {
    resolve(manifest.domNodes.map(function (file) { return manifest.files[file.path]; }).filter(function (file) { return !!file; }))
  });

  return fs.exists(localDirectory + config.manifestFile).then(function(localManifestEntry) {
    if (!localManifestEntry) {
      console.log('no local manifest found.');
      return Object.keys(manifest.files).map(function (filePath) {return manifest.files[filePath]});
    }

    return fs.readJSON(localDirectory + config.manifestFile).then(function (localManifest) {
      var remoteFiles = manifest.files || {};
      var localFiles = localManifest.files || {};

      // looking for files to download
      var newFiles = [];
      for (var filePath in remoteFiles) {
        var localFile = localFiles[filePath];
        var remoteFile = remoteFiles[filePath];
        if (!localFile || localFile.hash !== remoteFile.hash) {
          newFiles.push(remoteFile);
          console.log('files to download:', filePath)
        }
      }

      // looking for files to delete
      var removePromises = [];
      for (var filePath in localFiles) {
        if (!remoteFiles[filePath]) {
          removePromises.push(fs.remove(localDirectory + filePath));
          console.log('files to delete:', filePath)
        }
      }

      return all(removePromises).then(function () {
        return newFiles;
      });
    });
  });
}

function xhrPromise(url, responseType) {
  responseType = responseType || 'arraybuffer';

  return new Promise(function (resolve, reject, progress) {
    var xhr = new window.XMLHttpRequest();

    xhr.onload = function (e) {
      if (this.status !== 200) {
        return reject('xhr status: ' + this.status + ', url: ' + url);
      }

      resolve({ response: this.response, mimeType: this.getResponseHeader('Content-Type')});
    };

    xhr.onerror = function (e) {
      reject('xhr failed: ' + url);
    }
    xhr.ontimeout = function () {
      reject('xhr timeout: ' + url)
    };
    xhr.onabort = function () {
      reject('xhr abort: ' + url)
    };
    xhr.addEventListener('progress', function (event) {
      progress(event.loaded);
    });

    xhr.open('GET', url, true);

    xhr.responseType = responseType;

    xhr.send();
  });
}

function writeFile(path, content, mimeType) {
  return fs.ensure(fs.dirname(path)).then(function () {
    return fs.file(path, { create: true });
  }).then(function (fileEntry) {
    return new Promise(function (resolve, reject) {
      fileEntry.createWriter(function (writer) {
        writer.onwriteend = function () {
          resolve(fileEntry);
        };
        writer.onerror = reject;
        writer.write(content, { type: mimeType });
      }, reject);
    });
  });
}

function computeMD5(fileEntry) {
  return new Promise(function (resolve, reject) {
    if (window.md5chksum) {
      md5chksum.file(fileEntry, resolve, reject);
    } else {
      md5 = SparkMD5.ArrayBuffer.hash(fileEntry);
      resolve(md5);
    }
  });
}

function downloadFile(serverAddress, file) {
  var url = serverAddress + '/' + file.path + '?' + file.hash;

  var previousBytes = 0;

  var fileContents = null;

  return xhrPromise(url).progress(function (loaded) {
    var bytes = loaded - previousBytes;
    previousBytes = loaded;

    loadedBytes += bytes;
    loader.emit('progress', loadedBytes, totalBytes);
  }).then(function (xhr) {
    fileContents = xhr.response;
    return writeFile(localDirectory + file.path, xhr.response, xhr.mimeType);
  }).then(computeMD5).then(function (md5) {
    if (md5 !== file.hash) {
      console.error('wrong hash file:', file, 'computed hash:', md5);
      throw new Error('Incorrect hash for the file: ' + file.name);
    }
    return { file: file, contents: fileContents };
  });
}

function downloadFiles(serverAddress, files) {
  if (!files.length) { return; }

  totalBytes = files.reduce(function (total, file) { return total + file.size }, 0);
  loadedBytes = 0;

  console.log(files.length + ' files to download..');

  var promises = files.map(throat(5, function (file) {
    return downloadFile(serverAddress, file);
  }));

  return all(promises);
}

function updateNodeAttributes(node, nodeInfo) {
  if (nodeInfo.attributes) {
    for (var key in nodeInfo.attributes) {
      node.setAttribute(key, nodeInfo.attributes[key]);
    }
  }
}

function createScriptNode(fileCache, nodeInfo, nativeDirectoryPath) {
  var isCached = fileCache.hasOwnProperty(nodeInfo.path);

  var node = document.createElement('script');
  node.setAttribute('type', 'text/javascript');

  updateNodeAttributes(node, nodeInfo);

  return new Promise(function (resolve, reject) {
    if (isCached) {
      var contents = fileCache[nodeInfo.path].contents;
      var blob = new Blob([contents]);

      var fileReader= new FileReader();

      fileReader.onload = function(e) {
        node.text = e.target.result;
        node.id = nodeInfo.path;
        resolve()
      };

      fileReader.onerror = function (e) {
        if (nodeInfo.optional) {
          return resolve();
        }
        console.error('error reading: ', nodeInfo, error);
        reject(e);
      };

      fileReader.readAsText(blob);

      document.body.appendChild(node);
    } else {
      node.onload = resolve;

      node.onerror = function (error) {
        if (nodeInfo.optional) {
          return resolve();
        }
        console.error('error loading: ', nodeInfo, error);
        reject(error);
      };

      node.setAttribute('src', nodeInfo.path);

      document.body.appendChild(node);
    }
  });
}

function createStyleSheetNode(fileCache, nodeInfo, nativeDirectoryPath) {
  var isCached = fileCache.hasOwnProperty(nodeInfo.path);

  return new Promise(function (resolve, reject) {
    if (isCached) {
      var node = document.createElement('style');
      node.setAttribute('type', 'text/css');

      updateNodeAttributes(node, nodeInfo);

      var contents = fileCache[nodeInfo.path].contents;
      var blob = new Blob([contents], {type: 'text/css'});

      var fileReader= new FileReader();

      fileReader.onload = function(e) {
        try {
          node.innerHTML = e.target.result
        } catch (e) {
          console.error(e);
          return reject(e);
        }
        node.id = nodeInfo.path;
        resolve()
      };

      fileReader.onerror = function (e) {
        if (nodeInfo.optional) {
          return resolve();
        }
        console.error('error reading: ', nodeInfo, error);
        reject(e);
      };

      fileReader.readAsText(blob);

      document.body.appendChild(node);
    } else {
      var node = document.createElement('link');

      node.setAttribute('type', 'text/css');
      node.setAttribute('rel', 'stylesheet');

      updateNodeAttributes(node, nodeInfo);

      node.onload = resolve;

      node.onerror = function (error) {
        if (nodeInfo.optional) {
          return resolve();
        }
        console.error('error loading: ', nodeInfo, error);
        reject(error);
      };

      node.setAttribute('href', nodeInfo.path);

      document.body.appendChild(node);
    }
  });
}

function loadNodePromise(fileCache, nodeInfo, nativeDirectoryPath) {
  var isCached = fileCache.hasOwnProperty(nodeInfo.path);

  var type = isCached ? fileCache[nodeInfo.path].file.type : nodeInfo.type;

  if (type === 'js') {
    return createScriptNode(fileCache, nodeInfo, nativeDirectoryPath)
  }

  if (type === 'css') {
    return createStyleSheetNode(fileCache, nodeInfo, nativeDirectoryPath);
  }

  throw new Error('Unknown node type: ' + type);
}

function loadNodes(manifest, fileCache, nativeDirectoryPath) {
  console.log('load dom nodes.');

  return all(manifest.domNodes.map(throat(1, function (nodeInfo) {
    return loadNodePromise(fileCache, nodeInfo, nativeDirectoryPath);
  })));
}

function saveManifest(manifest) {
  console.log('save manifest.');
  return writeFile(localDirectory + config.manifestFile, JSON.stringify(manifest, null, 2), 'application/json');
}

var loader = new EventEmitter();

loader.initialize = function () {
}

loader.load = function () {
  var serverAddress = config.server;
  var manifest = {};
  var nativeDirectoryPath = '';
  var fileCache = {};

  retrieveServerAddress().then(function (address) {
    serverAddress = address || serverAddress;
    return retrieveRemoteManifest(serverAddress);
  }).then(function (remoteManifest) {
    manifest = remoteManifest || manifest;
    return setupDirectories();
  }).then(function (path) {
    nativeDirectoryPath = path || nativeDirectoryPath;
    return checkForFileUpdate();
  }).then(function (files) {
    return downloadFiles(serverAddress, files);
  }).then(function (filesWithContent) {
    filesWithContent.forEach(function (fileWithContent) {
      fileCache[fileWithContent.file.path] = fileWithContent;
    });
    return saveManifest(manifest);
  }).then(function () {
    return loadNodes(manifest, fileCache, nativeDirectoryPath);
  }).then(function () {
    loader.emit('loaded');
  }).catch(function (e) {
    console.error('loader error', e);
    if (window.Bugsnag) {
      window.Bugsnag.notifyException(e);
    }
    loader.emit('error', e.message || JSON.stringify(e, null, 2));
  });
};

module.exports = loader;
