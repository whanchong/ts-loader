var EventEmitter = require('events').EventEmitter;
var Promise = require('q').Promise;
var semver = require('semver');
var throat = require('throat')(Promise);
var SparkMD5 = require('spark-md5');

var CordovaPromiseFS = require('./cordova-promise-fs.js');
var LocalStoragePromiseFS = require('./local-storage-promise-fs.js');
var objectAssign = require('./object-assign.js');
var xhrPromise = require('./xhr-promise.js');

var hasBrowserFeatures = require('./has-browser-features.js');
var isCordova = typeof window !== 'undefined' && typeof window.cordova !== 'undefined';

var fs;
if (isCordova) {
  fs = CordovaPromiseFS({
    persistent: true,
    concurrency: 3,
    Promise: Promise
  });
} else {
  fs = LocalStoragePromiseFS;
}

var NOT_FOUND_ERR = 1;

var loaderConfig = {
  manifestFile: 'app-manifest.json',
  supportedManifestVersion: '^2.0.0'
};

var totalBytes, loadedBytes;

function getLocalHashes() {
  var content = window.localStorage.getItem('localHashes');

  if (!content) {
    return {};
  }

  try {
    return JSON.parse(content);
  } catch (e) {
    console.warn('Error reading localHashes from localStorage', e);
    return {};
  }
}

var localHashes = getLocalHashes();

function updateLocalHash(file) {
  localHashes[file.manifestEntry.path] = file.md5;

  var stringified = JSON.stringify(localHashes);

  window.localStorage.setItem('localHashes', stringified);
}

function getAppHost(config) {
  function cordovaAppHost() {
    return new Promise(function (resolve, reject) {
      if (!isCordova || config.ignoreAppSettings || typeof window.plugins === 'undefined') {
        return resolve();
      }
      return window.plugins.appPreferences.fetch(resolve, reject, 'appHost');
    });
  }

  function publicPath() {
    return fs.dir().then(function (directoryEntry) { return directoryEntry.nativeURL; });
  }

  return Promise.all([cordovaAppHost(), publicPath()]).then(function (moreConfig) {
    return {
      appHost: moreConfig[0],
      publicPath: moreConfig[1]
    };
  });
}


function localFile(path) {
  return fs.readJSON(path).catch(function (error) {
    if (error && (error.code !== NOT_FOUND_ERR)) {
      throw error;
    }
  }).then(function (content) {
    if (!content) {
      return;
    }

    var md5 = localHashes[path];

    var file = {
      content: content,
      manifestEntry: {
        path: path
      },
      md5: md5
    };

    return file;
  });
}

function remoteFile(path, config) {
  var url = (config.appHost || '') + '/' + path;

  return xhrPromise(url).catch(function (error) {
    console.error(error);
  }).then(function (xhr) {
    if (!xhr) {
      return;
    }

    var file = {
      content: null,
      contentType: xhr.contentType,
      fileBuffer: xhr.response,
      manifestEntry: {
        path: path
      }
    };

    if (!config.performHash) {
      return file;
    }

    return getMD5(file.fileBuffer).then(function (md5) {
      file.md5 = md5;

      return file;
    });
  });
}

function validateAppManifest(manifest, config) {
  if (!manifest) {
    throw new Error('Could not load manifest. Please check your connection and try again.');
  }

  if (!semver.satisfies(manifest.manifestVersion, config.supportedManifestVersion)) {
    throw new Error('Your application version is too low. Please visit the App Store and update your application.');
  }

  if (typeof manifest.files !== 'object') {
    throw new Error('Expected appManifest.files to be an object');
  }
  if (!Array.isArray(manifest.domNodes)) {
    throw new Error('Expected appManifest.domNodes to be an array');
  }
}

function getAppManifest(config) {
  var path = config.manifestFile;

  return Promise.all([ localFile(path), remoteFile(path, config) ]).then(function (files) {
    var localFile = files[0];
    var remoteFile = files[1];

    if (localFile && remoteFile) {
      if (remoteFile.md5 && remoteFile.md5 === localFile.md5) {
        return localFile;
      }
    }

    return remoteFile || localFile;
  }).then(function (file) {
    if (!file || !file.fileBuffer || !file.contentType || file.content) {
      return file; // Nothing to write
    }

    file.blob = new Blob([file.fileBuffer], { type: file.contentType });

    return writeFile(file, config).then(function () {
      return new Promise(function (resolve, reject) {
        var blob = file.blob;
        var fileReader = new FileReader();

        fileReader.onload = function(event) {
          file.content = JSON.parse(event.target.result);
          resolve(file);
        };

        fileReader.onerror = function (error) {
          reject(error);
        };

        fileReader.readAsText(blob);
      });
    });
  }).then(function (file) {
    var manifest = file && file.content;

    validateAppManifest(manifest, config);

    return file;
  });
}

function getFilesToLoad(manifest, config) {
  var fileNames = Object.keys(manifest.files);
  if (!isCordova) {
    // Get only files needed as dom node
    fileNames = manifest.domNodes.map(function (domNode) {
      return domNode.path;
    });
  }
  var filesToLoad = fileNames.map(function (fileName) {
    return manifest.files[fileName];
  }).filter(function (file) {
    return file && (!config.useLocalCache || file.hash != localHashes[file.path]);
  });

  return filesToLoad;
}

function writeFile(file, config) {
  var path = file.manifestEntry.path;
  var contentType = file.contentType;

  var blob = file.blob || new Blob([file.fileBuffer], { type: contentType });

  return fs.ensure(fs.dirname(path)).then(function () {
    return fs.file(path, { create: true });
  }).then(function (fileEntry) {
    return new Promise(function (resolve, reject) {
      if (!config.useLocalCache) {
        return resolve();
      }

      fileEntry.createWriter(function (writer) {
        writer.onwriteend = function () {
          resolve();
        };
        writer.onerror = reject;
        writer.write(blob);
      }, reject);
    });
  }).then(function () {
    if (config.useLocalCache) {
      updateLocalHash(file);
    }

    return file;
  });
}

function getMD5(fileEntry) {
  return new Promise(function (resolve, reject) {
    if (window.md5chksum) {
      window.md5chksum.file(fileEntry, resolve, reject);
    } else {
      resolve(SparkMD5.ArrayBuffer.hash(fileEntry));
    }
  });
}

function downloadFile(config, manifestEntry) {
  var appHost = config.appHost;
  var url = appHost + '/' + manifestEntry.path;

  var previousBytes = 0;

  var fileBuffer = null;
  var contentType = null;

  return xhrPromise(url).progress(function (event) {
    var bytes = event.loaded - previousBytes;
    previousBytes = event.loaded;

    // Firefox reports compressed bytes loaded, so we have to estimate how many uncompressed
    // bytes have been loaded.
    var estimatedBytes = 0;

    if (event.total && event.total < manifestEntry.size) {
      estimatedBytes = Math.floor(manifestEntry.size * event.loaded / event.total);
    }

    loadedBytes += estimatedBytes || bytes;

    loader.emit('progress', loadedBytes, totalBytes);
  }).then(function (xhr) {
    fileBuffer = xhr.response;
    contentType = xhr.contentType;

    if (!config.performHash) {
      return manifestEntry.hash;
    }

    if (!fileBuffer) {
      console.warn(manifestEntry.path + ' file was empty');
      return manifestEntry.hash;
    } else {
      return getMD5(fileBuffer);
    }
  }).then(function (md5) {
    if (md5 !== manifestEntry.hash) {
      throw new Error('md5 mismatch: ' + manifestEntry.path + ' ' + manifestEntry.hash + ' computed: ' + md5);
    }

    return { manifestEntry: manifestEntry, fileBuffer: fileBuffer, contentType: contentType, md5: md5 };
  });
}

function downloadFiles(config, files) {
  totalBytes = files.reduce(function (total, file) { return total + file.size; }, 0);
  loadedBytes = 0;

  var promises = files.map(throat(5, function (file) {
    return downloadFile(config, file);
  }));

  return Promise.all(promises);
}

function updateNodeAttributes(node, nodeInfo) {
  if (nodeInfo.attributes) {
    for (var key in nodeInfo.attributes) {
      node.setAttribute(key, nodeInfo.attributes[key]);
    }
  }
}

function createLocalScriptNode(fileCache, nodeInfo, config) {
  return new Promise(function (resolve, reject) {
    var node = document.createElement('script');
    node.setAttribute('type', 'text/javascript');

    if (config.publicPath) {
      node.setAttribute('data-public-path', config.publicPath);
    }

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
      var text = e.target.result;

      // because we are creating the node manually and not with src,
      // we need to provide sourceURl for source map to work
      sourceURL = '\n//# sourceURL=' + nodeInfo.path;
      text += sourceURL;

      node.text = text;
      node.id = nodeInfo.path;

      resolve(node);
    };

    fileReader.onerror = function (e) {
      if (nodeInfo.optional) {
        return resolve(node);
      }
      console.error('error reading: ', nodeInfo, e);
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

function createLocalStyleSheetNode(fileCache, nodeInfo, config) {
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
      var text = e.target.result;

      // because we are creating the node manually and not with src,
      // we need to provide sourceURl for source map to work
      sourceURL = '\n//# sourceURL=' + nodeInfo.path;
      text += sourceURL;

      try {
        node.innerHTML = text;
      } catch (e) {
        console.error(e);
        return reject(e);
      }
      node.id = nodeInfo.path;
      resolve(node);
    };

    fileReader.onerror = function (e) {
      if (nodeInfo.optional) {
        return resolve(node);
      }
      console.error('error reading: ', nodeInfo, e);
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

function createNode(fileCache, nodeInfo, config) {
  var isCached = fileCache.hasOwnProperty(nodeInfo.path);
  var type = isCached ? fileCache[nodeInfo.path].manifestEntry.type : nodeInfo.type;

  if (type === 'js') {
    if (isCached) {
      return createLocalScriptNode(fileCache, nodeInfo, config);
    }
    return createRemoteScriptNode(nodeInfo);
  }

  if (type === 'css') {
    if (isCached) {
      return createLocalStyleSheetNode(fileCache, nodeInfo, config);
    }
    return createRemoteStyleSheetNode(nodeInfo);
  }

  throw new Error('Unknown node type: ' + type);
}

function loadFilesFromCache(manifest, fileCache, files) {
  var filesToLoad = [];

  files.forEach(function (file) {
    fileCache[file.manifestEntry.path] = file;
  });

  manifest.domNodes.forEach(function (nodeInfo) {
    if (!fileCache[nodeInfo.path] && manifest.files[nodeInfo.path]) {
      filesToLoad.push(manifest.files[nodeInfo.path]);
    }
  });

  return Promise.all(filesToLoad.map(function (file) {
    return fs.read(file.path).then(function (content) {
      fileCache[file.path] = { manifestEntry: file, content: content };
    }).catch(function (error) {
      console.error(error);
    });
  }));
}

var loader = new EventEmitter();

loader.unsupportedBrowserLoad = function (config) {
  var manifest;
  var url = (config.appHost || '') + '/' + config.manifestFile;

  return xhrPromise(url, 'text').then(function (xhr) {
    try {
      manifest = JSON.parse(xhr.response);
    } catch (e) {
      throw new Error('Failed to parse manifest.');
    }

    validateAppManifest(manifest, config);

    return Promise.all(manifest.domNodes.map(throat(1, function (nodeInfo) {
      return createNode(loader.fileCache, nodeInfo, config);
    })));
  });
};

loader.normalLoad = function (config) {
  var manifest;
  var fileCache = loader.fileCache;

  return getAppManifest(config).then(function (appManifest) {
    fileCache[config.manifestFile] = appManifest;
    manifest = appManifest.content;
    return getFilesToLoad(manifest, config);
  }).then(function (files) {
    return downloadFiles(config, files);
  }).then(function (files) {
    return Promise.all(files.map(function (file) {
      return writeFile(file, config);
    }));
  }).then(function (files) {
    return loadFilesFromCache(manifest, fileCache, files);
  }).then(function () {
    return Promise.all(manifest.domNodes.map(throat(1, function (nodeInfo) {
      return createNode(fileCache, nodeInfo, config);
    })));
  });
};

loader.load = function (runtimeConfig) {
  // We're passing in a dataSet as runtimeConfig and Safari's Object.assign doesn't work with it
  // so we use our own objectAssign that doesn't mutate data.

  var config = this.config = objectAssign(loaderConfig, runtimeConfig);

  this.fileCache = {};

  getAppHost(config).then(function(returnedAppConfig) {
    config.appHost = returnedAppConfig.appHost || config.appHost || '';

    if (!config.publicPath && config.appHost) {
      config.publicPath = config.appHost + '/';
    }

    // add fallback for browsers with unsupported features
    if (!isCordova && !hasBrowserFeatures) {
      return loader.unsupportedBrowserLoad(config);
    }

    return loader.normalLoad(config);
  }).then(function () {
    loader.emit('loaded');
  }).catch(function (e) {
    console.error('loader error', e);

    window.Bugsnag && window.Bugsnag.notifyException(e);

    loader.emit('error', e.message || JSON.stringify(e, null, 2));
  });
};

module.exports = loader;
