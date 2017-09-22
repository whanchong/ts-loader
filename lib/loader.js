import { EventEmitter } from 'events';
import semver from 'semver';
import SparkMD5 from 'spark-md5';
import throater from 'throat';

import CordovaPromiseFS from './cordova-promise-fs';
import LocalStoragePromiseFS from './local-storage-promise-fs';
import objectAssign from './object-assign';
import xhrPromise from './xhr-promise';
import hasBrowserFeatures from './has-browser-features';

const throat = throater(Promise);

const isCordova = typeof window !== 'undefined' && typeof window.cordova !== 'undefined';

const loader = new EventEmitter();

let fs;
if (isCordova) {
  fs = CordovaPromiseFS({
    persistent: true,
    concurrency: 3,
    Promise
  });
} else {
  fs = LocalStoragePromiseFS;
}

const NOT_FOUND_ERR = 1;

const loaderConfig = {
  manifestFile: 'app-manifest.json',
  supportedManifestVersion: '^2.0.0'
};


function getLocalHashes() {
  const content = window.localStorage.getItem('localHashes');

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

const localHashes = getLocalHashes();

function updateLocalHash(file) {
  localHashes[file.manifestEntry.path] = file.md5;

  const stringified = JSON.stringify(localHashes);

  window.localStorage.setItem('localHashes', stringified);
}


function writeFile(file, config) {
  if (!config.useLocalCache) {
    return Promise.resolve(file);
  }
  const path = file.manifestEntry.path;

  const blob = file.blob || new Blob([file.fileBuffer], { type: file.contentType });
  return fs.write(path, blob, file.contentType)
    .then(() => {
      updateLocalHash(file);
      return file;
    }
  );
}

function getMD5(fileEntry) {
  return new Promise((resolve, reject) => {
    if (window.md5chksum) {
      window.md5chksum.file(fileEntry, resolve, reject);
    } else {
      resolve(SparkMD5.ArrayBuffer.hash(fileEntry));
    }
  });
}

function getBasicInfo(config) {
  function getAppHost() {
    if (
      !isCordova ||
      config.ignoreAppSettings ||
      typeof window.plugins === 'undefined' ||
      !window.plugins.appPreferences
    ) {
      return '';
    }
    return window.plugins.appPreferences.fetch('appHost');
  }

  function publicPath() {
    return fs.dir().then(directoryEntry => directoryEntry.nativeURL);
  }

  return Promise.all([getAppHost(), publicPath()]).then((moreConfig) => {
    return {
      appHost: moreConfig[0],
      publicPath: moreConfig[1]
    };
  });
}


function getLocalFile(path) {
  return fs.readJSON(path).catch((error) => {
    if (error && (error.code !== NOT_FOUND_ERR)) {
      throw error;
    }
  }).then((content) => {
    if (!content) {
      return null;
    }

    const md5 = localHashes[path];

    const file = {
      content,
      manifestEntry: {
        path
      },
      md5
    };

    return file;
  });
}

function getRemoteFile(path, config) {
  const url = `${(config.appHost || '')}/${path}`;

  return xhrPromise(url).catch((error) => {
    console.error(error);
  }).then((xhr) => {
    if (!xhr) {
      return null;
    }

    const file = {
      content: null,
      contentType: xhr.contentType,
      fileBuffer: xhr.response,
      manifestEntry: {
        path
      }
    };

    if (!config.performHash) {
      return file;
    }

    return getMD5(file.fileBuffer).then((md5) => {
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
  const path = config.manifestFile;

  return Promise.all([getLocalFile(path), getRemoteFile(path, config)])
    .then((files) => {
      const localFile = files[0];
      const remoteFile = files[1];

      if (localFile && remoteFile) {
        if (remoteFile.md5 && remoteFile.md5 === localFile.md5) {
          return localFile;
        }
      }

      return remoteFile || localFile;
    })
    .then((file) => {
      if (!file || !file.fileBuffer || !file.contentType || file.content) {
        return file; // Nothing to write
      }

      file.blob = new Blob([file.fileBuffer], { type: file.contentType });

      return writeFile(file, config)
        .then(() => new Promise((resolve, reject) => {
          const blob = file.blob;
          const fileReader = new FileReader();

          fileReader.onload = (event) => {
            file.content = JSON.parse(event.target.result);
            resolve(file);
          };

          fileReader.onerror = reject;

          fileReader.readAsText(blob);
        }));
    })
    .then((file) => {
      const manifest = file && file.content;
      validateAppManifest(manifest, config);

      return file;
    });
}

function getFilesToLoad(manifest, config) {
  let fileNames = Object.keys(manifest.files);
  if (!isCordova) {
    // Get only files needed as dom node
    fileNames = manifest.domNodes.map(domNode => domNode.path);
  }
  const filesToLoad = fileNames.map(fileName => manifest.files[fileName])
    .filter(file => file && (!config.useLocalCache || file.hash !== localHashes[file.path]));

  return filesToLoad;
}

function downloadFile(config, file, progress) {
  const appHost = config.appHost;
  const url = `${appHost}/${file.path}`;

  let fileBuffer = null;
  let contentType = null;

  return xhrPromise(url, { progress })
    .then((xhr) => {
      fileBuffer = xhr.response;
      contentType = xhr.contentType;

      if (!config.performHash) {
        return file.hash;
      }

      if (!fileBuffer) {
        console.warn(`${file.path} file was empty`);
        return file.hash;
      }
      return getMD5(fileBuffer);
    })
    .then((md5) => {
      if (md5 !== file.hash) {
        throw new Error(`md5 mismatch: ${file.path} ${file.hash} computed: ${md5}`);
      }
      return { manifestEntry: file, fileBuffer, contentType, md5 };
    });
}

function onProgress(fileStatus, { loaded, total }) {
  const bytes = loaded - fileStatus.previousBytes;
  fileStatus.previousBytes = loaded;

  // Firefox reports compressed bytes loaded, so we have to estimate how many uncompressed
  // bytes have been loaded.
  let estimatedBytes = bytes;

  if (total && total < fileStatus.size) {
    estimatedBytes = Math.floor(fileStatus.size * loaded / total);
  }

  loader.loadedBytes += estimatedBytes;
  loader.emit('progress', loader.loadedBytes, loader.totalBytes);
}

function downloadFiles(config, files) {
  loader.loadedBytes = 0;
  loader.totalBytes = files.filter(file => file)
    .reduce((total, file) => {
      return total + file.size;
    }, 0);

  const promises = files.map(throat(5, (file) => {
    const fileStatus = {
      previousBytes: 0,
      size: file.size
    };
    return downloadFile(config, file, onProgress.bind(null, fileStatus));
  }));

  return Promise.all(promises);
}

function updateNodeAttributes(node, nodeInfo) {
  if (nodeInfo.attributes) {
    Object.keys(nodeInfo.attributes).forEach((key) => {
      node.setAttribute(key, nodeInfo.attributes[key]);
    });
  }
}

function createLocalScriptNode(fileCache, nodeInfo, config) {
  const node = document.createElement('script');
  node.setAttribute('type', 'text/javascript');

  if (config.publicPath) {
    node.setAttribute('data-public-path', config.publicPath);
  }

  updateNodeAttributes(node, nodeInfo);

  document.body.appendChild(node);

  if (fileCache[nodeInfo.path].content) {
    node.text = fileCache[nodeInfo.path].content;
    node.id = nodeInfo.path;
    return Promise.resolve(node);
  }

  return new Promise((resolve, reject) => {
    const fileBuffer = fileCache[nodeInfo.path].fileBuffer;
    const blob = new Blob([fileBuffer], { type: 'text/javascript' });
    const fileReader = new FileReader();

    fileReader.onload = (e) => {
      let text = e.target.result;

      if (config.rewriteSourcemaps) {
        let sourceIndex = text.lastIndexOf('\n//# sourceMappingURL=');

        if (sourceIndex === -1) {
          sourceIndex = text.length;
        }
        const newSource = `\n//# sourceMappingURL=${nodeInfo.path.replace('.js', '.map')}`;

        text = text.substring(0, sourceIndex).concat(newSource);
      }

      node.text = text;
      node.id = nodeInfo.path;

      resolve(node);
    };

    fileReader.onerror = (e) => {
      if (nodeInfo.optional) {
        return resolve(node);
      }
      console.error('error reading:', nodeInfo, e);
      return reject(e);
    };

    fileReader.readAsText(blob);
  });
}

function createRemoteScriptNode(nodeInfo) {
  return new Promise((resolve, reject) => {
    const node = document.createElement('script');
    node.setAttribute('type', 'text/javascript');

    updateNodeAttributes(node, nodeInfo);

    node.onload = () => resolve(node);

    node.onerror = (error) => {
      if (nodeInfo.optional) {
        return resolve(node);
      }
      console.error('error loading: ', nodeInfo, error);
      return reject(error);
    };

    node.setAttribute('src', nodeInfo.path);

    document.body.appendChild(node);
  });
}

function createLocalStyleSheetNode(fileCache, nodeInfo, config) {
  const node = document.createElement('style');
  node.setAttribute('type', 'text/css');

  updateNodeAttributes(node, nodeInfo);

  document.body.appendChild(node);

  if (fileCache[nodeInfo.path].content) {
    node.innerHTML = fileCache[nodeInfo.path].content;
    node.id = nodeInfo.path;
    return Promise.resolve(node);
  }

  return new Promise((resolve, reject) => {
    const fileBuffer = fileCache[nodeInfo.path].fileBuffer;
    const blob = new Blob([fileBuffer], { type: 'text/css' });

    const fileReader = new FileReader();

    fileReader.onload = (e) => {
      let text = e.target.result;

      if (config.rewriteSourcemaps) {
        let sourceIndex = text.lastIndexOf('\n/*# sourceMappingURL=');

        if (sourceIndex === -1) {
          sourceIndex = text.length;
        }

        let newSource = `\n/*# sourceURL=${location.origin}/${nodeInfo.path} */`;
        newSource += `\n/*# sourceMappingURL=../${nodeInfo.path}.map */`;

        text = text.substring(0, sourceIndex).concat(newSource);
      }

      try {
        node.innerHTML = text;
      } catch (err) {
        console.error(err);
        return reject(err);
      }
      node.id = nodeInfo.path;
      return resolve(node);
    };

    fileReader.onerror = (e) => {
      if (nodeInfo.optional) {
        return resolve(node);
      }
      console.error('error reading: ', nodeInfo, e);
      return reject(e);
    };

    fileReader.readAsText(blob);
  });
}

function createStyleSheetNode(nodeInfo) {
  return fs.toURL(nodeInfo.path).then((filePath) => {
    return new Promise((resolve, reject) => {
      const node = document.createElement('link');

      node.setAttribute('type', 'text/css');
      node.setAttribute('rel', 'stylesheet');

      updateNodeAttributes(node, nodeInfo);

      node.onload = resolve;

      node.onerror = (error) => {
        if (nodeInfo.optional) {
          return resolve();
        }
        console.error('error loading: ', nodeInfo, error);
        return reject(error);
      };

      node.setAttribute('href', filePath);

      document.body.appendChild(node);
    });
  });
}

function createRemoteStyleSheetNode(nodeInfo) {
  return new Promise((resolve, reject) => {
    const node = document.createElement('link');

    node.setAttribute('type', 'text/css');
    node.setAttribute('rel', 'stylesheet');

    updateNodeAttributes(node, nodeInfo);

    node.onload = resolve;

    node.onerror = (error) => {
      if (nodeInfo.optional) {
        return resolve();
      }
      console.error('error loading: ', nodeInfo, error);
      return reject(error);
    };

    node.setAttribute('href', nodeInfo.path);

    document.body.appendChild(node);
  });
}

function createNode(fileCache, nodeInfo, config) {
  const isCached = !!fileCache[nodeInfo.path];
  const type = isCached ? fileCache[nodeInfo.path].manifestEntry.type : nodeInfo.type;

  if (type === 'js') {
    if (isCached) {
      return createLocalScriptNode(fileCache, nodeInfo, config);
    }
    return createRemoteScriptNode(nodeInfo);
  }

  if (type === 'css') {
    if (isCordova) {
      return createStyleSheetNode(nodeInfo);
    }
    if (isCached) {
      return createLocalStyleSheetNode(fileCache, nodeInfo, config);
    }
    return createRemoteStyleSheetNode(nodeInfo);
  }

  throw new Error(`Unknown node type: ${type}`);
}

function loadFilesFromCache(manifest, fileCache, files) {
  const filesToLoad = [];

  files.forEach((file) => {
    fileCache[file.manifestEntry.path] = file;
  });

  manifest.domNodes.forEach((nodeInfo) => {
    if (!fileCache[nodeInfo.path] && manifest.files[nodeInfo.path]) {
      filesToLoad.push(manifest.files[nodeInfo.path]);
    }
  });

  return Promise.all(filesToLoad.map((file) => {
    return fs.read(file.path, 'readAsArrayBuffer')
      .then((fileBuffer) => {
        fileCache[file.path] = { manifestEntry: file, fileBuffer };
      })
      .catch((error) => {
        console.error(error);
        throw error;
      });
  }));
}

loader.unsupportedBrowserLoad = (config) => {
  let manifest;
  const url = `${(config.appHost || '')}/${config.manifestFile}`;

  return xhrPromise(url, { responseType: 'text' }).then((xhr) => {
    try {
      manifest = JSON.parse(xhr.response);
    } catch (e) {
      throw new Error('Failed to parse manifest.');
    }

    validateAppManifest(manifest, config);

    return Promise.all(manifest.domNodes.map(throat(1, (nodeInfo) => {
      return createNode(loader.fileCache, nodeInfo, config);
    })));
  });
};

loader.normalLoad = (config) => {
  let manifest;
  const fileCache = loader.fileCache;

  return getAppManifest(config)
    .then((appManifest) => {
      fileCache[config.manifestFile] = appManifest;
      manifest = appManifest.content;
      return getFilesToLoad(manifest, config);
    })
    .then(files => downloadFiles(config, files))
    .then((files) => {
      return Promise.all(files.map((file) => {
        return writeFile(file, config);
      }));
    })
    .then(files => loadFilesFromCache(manifest, fileCache, files))
    .then(() => {
      return Promise.all(manifest.domNodes.map(throat(1, (nodeInfo) => {
        return createNode(fileCache, nodeInfo, config);
      })));
    });
};

loader.load = (runtimeConfig) => {
  // We're passing in a dataSet as runtimeConfig and Safari's Object.assign doesn't work with it
  // so we use our own objectAssign that doesn't mutate data.

  loader.config = objectAssign(loaderConfig, runtimeConfig);
  const config = loader.config;

  loader.fileCache = {};

  getBasicInfo(config)
    .then((returnedAppConfig) => {
      config.appHost = returnedAppConfig.appHost || config.appHost || '';

      if (!config.publicPath && config.appHost) {
        config.publicPath = `${config.appHost}/`;
      }

      // add fallback for browsers with unsupported features
      if (!isCordova && !hasBrowserFeatures) {
        return loader.unsupportedBrowserLoad(config);
      }

      return loader.normalLoad(config);
    })
    .then(() => {
      loader.emit('loaded');
    })
    .catch((e) => {
      console.error('loader error', e);
      if (window.Bugsnag) {
        window.Bugsnag.notifyException(e);
      }
      loader.emit('error', e.message || JSON.stringify(e, null, 2));
    });
};

export default loader;
