import { EventEmitter } from 'events';
import semver from 'semver';

import objectAssign from './object-assign';
import xhrPromise from './xhr-promise';
import isCordova from './isCordova';
import cordovaLoad from './cordovaLoad';
import browserLoad from './browserLoad';

export default class Loader {
  constructor(runtimeConfig, forceReload = false) {
    this.emitter = new EventEmitter();

    // We're passing in a dataSet as runtimeConfig and Safari's Object.assign doesn't work with it
    // so we use our own objectAssign that doesn't mutate data.
    this.config = objectAssign({
      manifestFile: 'app-manifest.json',
      supportedManifestVersion: '^2.0.0'
    }, runtimeConfig);

    window.cordovaFileCache = undefined;

    this.getAppHost(this.config)
    .then((returnedAppConfig) => {
      this.config.appHost = returnedAppConfig.appHost || this.config.appHost || '';

      if (!this.config.publicPath && this.config.appHost) {
        this.config.publicPath = `${this.config.appHost}/`;
      }

      if (!isCordova || !this.config.useLocalCache) {
        return this.normalLoad();
      }

      return this.cacheLoad(forceReload);
    })
    .then(() => {
      this.emitter.emit('loaded');
    })
    .catch((e) => {
      console.error('loader error', e);
      if (window.Bugsnag) {
        window.Bugsnag.notifyException(e);
      }
      this.emitter.emit('error', e.message || JSON.stringify(e, null, 2));
    });

    return this.emitter;
  }

  onProgress = ({ queueIndex, queueSize }) => {
    this.emitter.emit('progress', queueIndex, queueSize);
  };

  cacheLoad = (forceReload) => {
    return this.getAppManifest()
    .then((manifest) => {
      return cordovaLoad(this.config.publicPath, forceReload, manifest, this.onProgress);
    });
  };

  normalLoad = () => {
    return this.getAppManifest()
    .then((manifest) => {
      return browserLoad(this.config.publicPath, manifest, this.onProgress);
    });
  };

  getAppHost = (config) => {
    if (
      !isCordova ||
      config.ignoreAppSettings ||
      typeof window.plugins === 'undefined' ||
      !window.plugins.appPreferences
    ) {
      return Promise.resolve('');
    }
    return Promise.resolve(window.plugins.appPreferences.fetch('appHost'));
  };

  validateAppManifest = (manifest) => {
    if (!manifest) {
      throw new Error('Could not load manifest. Please check your connection and try again.');
    }

    if (!semver.satisfies(manifest.manifestVersion, this.config.supportedManifestVersion)) {
      throw new Error('Your application version is too low. Please visit the App Store and update your application.');
    }

    if (typeof manifest.files !== 'object') {
      throw new Error('Expected appManifest.files to be an object');
    }
    if (!Array.isArray(manifest.domNodes)) {
      throw new Error('Expected appManifest.domNodes to be an array');
    }
  };

  getAppManifest = () => {
    let manifest;
    const url = `${(this.config.appHost || '')}/${this.config.manifestFile}`;

    return xhrPromise(url, { responseType: 'text' }).then((xhr) => {
      try {
        manifest = JSON.parse(xhr.response);
      } catch (e) {
        throw new Error('Failed to parse manifest.');
      }

      this.validateAppManifest(manifest);

      return manifest;
    });
  };
}
