var EventEmitter = require('events').EventEmitter;
var all = require('q').all;
var Promise = window.Promise = require('q').Promise;
var semver = require('semver');
var throat = require('throat')(Promise);
var SparkMD5 = require('spark-md5');

var config = require('json!../package.json');
var fs = require('./local-storage-promise-fs');
var xhrPromise = require('./xhr-promise');

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

function checkForFileUpdate(manifest) {
  console.log('check for files update');

  // return new Promise(function (resolve, reject) {
  //   resolve(manifest.domNodes.map(function (nodeInfo) { return manifest.files[nodeInfo.path]; }).filter(function (file) { return !!file; }))
  // });

  return fs.exists(localDirectory + config.manifestFile).then(function(localManifestEntry) {
    if (!localManifestEntry) {
      console.log('no local manifest found.');
      return manifest.domNodes.map(function (nodeInfo) {return manifest.files[nodeInfo.path]; }).filter(function (file) { return !!file; });
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

function writeFile(file) {
  var path = file.manifestEntry.path;
  var contentType = file.contentType;
  var blob = file.blob || new Blob([file.fileBuffer], { type: contentType });

  return fs.ensure(fs.dirname(path)).then(function () {
    return fs.file(path, { create: true });
  }).then(function (fileEntry) {
    return new Promise(function (resolve, reject) {
      fileEntry.createWriter(function (writer) {
        writer.onwriteend = function () {
          resolve(fileEntry);
        };
        writer.onerror = reject;
        writer.write(blob);
      }, reject);
    });
  }).then(function () {
    return file;
  });
}

function compareMD5(fileEntry, hash) {
  return new Promise(function (resolve, reject) {
    if (window.md5chksum) {
      md5chksum.file(fileEntry, resolve, reject);
    } else {
      md5 = SparkMD5.ArrayBuffer.hash(fileEntry);
      resolve(md5);
    }
  });
}

function downloadFile(serverAddress, manifestEntry) {
  var url = serverAddress + '/' + manifestEntry.path + '?' + manifestEntry.hash;

  var previousBytes = 0;

  var fileBuffer = null;
  var contentType = null;

  return xhrPromise(url).progress(function (event) {
    var bytes = event.loaded - previousBytes;
    previousBytes = event.loaded;

    // Firefox likes to report compressed bytes loaded, so we have to estimate how many uncompressed
    // bytes have been loaded.
    var estimatedBytes = 0;

    if (event.total && event.total !== manifestEntry.size) {
      estimatedBytes = Math.floor(manifestEntry.size *  event.loaded / event.total);
    }

    loadedBytes += estimatedBytes || bytes;

    loader.emit('progress', loadedBytes, totalBytes);
  }).then(function (xhr) {
    fileBuffer = xhr.response;
    contentType = xhr.contentType;

    return compareMD5(fileBuffer, manifestEntry.hash);
  }).then(function (md5) {
    if (md5 !== manifestEntry.hash) {
      throw new Error('md5 mismatch: ' + hash + ' computed: ' + md5);
    }

    return { manifestEntry: manifestEntry, fileBuffer: fileBuffer, contentType: contentType, md5: md5 };
  });
}

function downloadFiles(serverAddress, files) {
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

function createLocalScriptNode(fileCache, nodeInfo) {
  return new Promise(function (resolve, reject) {
    var node = document.createElement('script');
    node.setAttribute('type', 'text/javascript');

    updateNodeAttributes(node, nodeInfo);

    document.body.appendChild(node);

    if (fileCache[nodeInfo.path].content) {
      node.text = fileCache[nodeInfo.path].content;
      node.id = nodeInfo.path;
      return resolve(node);
    }

    var fileBuffer = fileCache[nodeInfo.path].fileBuffer;
    var blob = new Blob([fileBuffer], {type: 'text/javscript'});

    var fileReader= new FileReader();

    fileReader.onload = function(e) {
      node.text = e.target.result;
      node.id = nodeInfo.path;
      resolve(node);
    };

    fileReader.onerror = function (e) {
      if (nodeInfo.optional) {
        return resolve(node);
      }
      console.error('error reading: ', nodeInfo, error);
      reject(e);
    };

    fileReader.readAsText(blob);
  });
}

function createRemoteScriptNode(nodeInfo) {
  return new Promise(function (resolve, reject) {
    var node = document.createElement('script');
    node.setAttribute('type', 'text/javascript');

    updateNodeAttributes(node, nodeInfo);

    node.onload = function () {
      resolve(node);
    };

    node.onerror = function (error) {
      if (nodeInfo.optional) {
        return resolve(node);
      }
      console.error('error loading: ', nodeInfo, error);
      reject(error);
    };

    node.setAttribute('src', nodeInfo.path);

    document.body.appendChild(node);
  });
}

function createLocalStyleSheetNode(fileCache, nodeInfo) {
  return new Promise(function (resolve, reject) {
    var node = document.createElement('style');
    node.setAttribute('type', 'text/css');

    updateNodeAttributes(node, nodeInfo);

    document.body.appendChild(node);

    if (fileCache[nodeInfo.path].content) {
      node.innerHTML = fileCache[nodeInfo.path].content;
      node.id = nodeInfo.path;
      return resolve(node);
    }

    var fileBuffer = fileCache[nodeInfo.path].fileBuffer;
    var blob = new Blob([fileBuffer], {type: 'text/css'});

    var fileReader= new FileReader();

    fileReader.onload = function(e) {
      try {
        node.innerHTML = e.target.result
      } catch (e) {
        console.error(e);
        return reject(e);
      }
      node.id = nodeInfo.path;
      resolve(node)
    };

    fileReader.onerror = function (e) {
      if (nodeInfo.optional) {
        return resolve(node);
      }
      console.error('error reading: ', nodeInfo, error);
      reject(e);
    };

    fileReader.readAsText(blob);
  });
}

function createRemoteStyleSheetNode(nodeInfo) {
  return new Promise(function (resolve, reject) {
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
  });
}

function loadNodePromise(fileCache, nodeInfo) {
  var isCached = fileCache.hasOwnProperty(nodeInfo.path);

  var type = isCached ? fileCache[nodeInfo.path].manifestEntry.type : nodeInfo.type;

  if (type === 'js') {
    if (isCached) {
      return createLocalScriptNode(fileCache, nodeInfo);
    }
    return createRemoteScriptNode(nodeInfo);
  }

  if (type === 'css') {
    if (isCached) {
      return createLocalStyleSheetNode(fileCache, nodeInfo);
    }
    return createRemoteStyleSheetNode(nodeInfo);
  }

  throw new Error('Unknown node type: ' + type);
}

function loadNodes(manifest, fileCache) {
  console.log('load dom nodes.');

  return all(manifest.domNodes.map(throat(1, function (nodeInfo) {
    return loadNodePromise(fileCache, nodeInfo);
  })));
}

function saveManifest(manifest) {
  console.log('save manifest.');
  var manifestEntry = { path: config.manifestFile };
  var blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });

  var file = { manifestEntry: manifestEntry, blob: blob };

  return writeFile(file);
}

function loadFilesFromCache(manifest, fileCache, files) {
  files.forEach(function (file) {
    fileCache[file.manifestEntry.path] = file;
  });

  var filesToLoad = [];

  manifest.domNodes.forEach(function (nodeInfo) {
    if (!fileCache[nodeInfo.path] && manifest.files[nodeInfo.path]) {
      filesToLoad.push(manifest.files[nodeInfo.path]);
    }
  });

  return filesToLoad.map(function (file) {
    fs.read(file.path).then(function (content) {
      fileCache[file.path] = { manifestEntry: file, content: content };
    });
  });
}

var loader = new EventEmitter();

loader.initialize = function () {};

loader.load = function () {
  var serverAddress = config.server;
  var manifest = {};
  var fileCache = {};

  retrieveServerAddress().then(function (address) {
    serverAddress = address || serverAddress;
    return retrieveRemoteManifest(serverAddress);
  }).then(function (remoteManifest) {
    manifest = remoteManifest || manifest;
    return setupDirectories();
  }).then(function (path) {
    return checkForFileUpdate(manifest);
  }).then(function (files) {
    return downloadFiles(serverAddress, files);
  }).then(function (files) {
    return all(files.map(writeFile));
  }).then(function (files) {
    return loadFilesFromCache(manifest, fileCache, files);
  }).then(function () {
    return saveManifest(manifest);
  }).then(function () {
    return loadNodes(manifest, fileCache);
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
