import 'classlist-polyfill';
import 'element-dataset';

import loader from './loader';
import customSplash from './custom-splash';

const isCordova = typeof window !== 'undefined' && typeof window.cordova !== 'undefined';

let deviceReady = !isCordova;
let loaded = false;
let loading = false;

function getDiv(id) {
  let loaderError = document.getElementById(id);

  if (!loaderError) {
    loaderError = document.createElement('DIV');
    loaderError.id = id;
    document.body.appendChild(loaderError);
  }

  return loaderError;
}

function showErrorMessage(message) {
  if (loaded) {
    return;
  }

  const loaderError = getDiv('loader-error');

  loaderError.innerHTML = `Error: ${message}`;
  loaderError.style.display = 'block';

  window.setTimeout(() => {
    customSplash.hideLoader();
  }, 200);
}

function parseDataAttribute(dataAttribute) {
  if (!dataAttribute || dataAttribute.toLowerCase() === 'true') {
    return true;
  } else if (dataAttribute.toLowerCase() === 'false') {
    return false;
  }
  return dataAttribute;
}


function getConfig() {
  const scriptNodes = document.getElementsByTagName('script');
  const currentlyLoadedScript = scriptNodes[scriptNodes.length - 1];
  const dataset = Object.keys(currentlyLoadedScript.dataset || {}).reduce((values, key) => {
    const value = currentlyLoadedScript.dataset[key];
    values[key] = parseDataAttribute(value);
    return values;
  }, {});
  return dataset;
}

function startLoading(event) {
  if (event.type === 'deviceready') {
    deviceReady = true;
  }

  if (loading || !deviceReady) {
    return;
  }

  loading = true;

  const config = getConfig();

  if (typeof window !== 'undefined' && typeof window.StatusBar !== 'undefined') {
    const statusBarBackgroundColor = config.statusBarBackgroundColor || '#282828';

    window.StatusBar.backgroundColorByHexString(statusBarBackgroundColor);
    window.StatusBar.overlaysWebView(false);
  }

  const fullHeight = document.documentElement.clientHeight;

  const statusBarTimeout = window.setTimeout(() => {
    customSplash.setStatusBarHeight(fullHeight - document.documentElement.clientHeight);
    customSplash.show();
  }, 0);

  const splashscreenTimeout = window.setTimeout(() => {
    customSplash.showLoader();
    if (window.navigator.splashscreen) {
      window.navigator.splashscreen.hide();
    }
  }, 200);

  loader.on('loaded', () => {
    window.clearTimeout(statusBarTimeout);
    window.clearTimeout(splashscreenTimeout);

    if (window.navigator.splashscreen) {
      window.navigator.splashscreen.hide();
    }

    if (window.plugins && window.plugins.notification) {
      window.plugins.notification.badge.hasPermission((granted) => {
        if (!granted) {
          window.plugins.notification.badge.registerPermission();
        }
      });
    }

    window.setTimeout(() => {
      customSplash.hide();
    }, 200);

    loader.removeAllListeners();
    loaded = true;
  });

  loader.on('error', showErrorMessage);

  loader.on('progress', (current, total) => {
    const progress = Math.max(Math.min(Math.round(100 * current / total), 100), 0);
    customSplash.setProgress(`${progress}%`);
  });

  if (navigator.connection && window.Connection && navigator.connection.type === window.Connection.NONE) {
    showErrorMessage('Please check your internet connection.');
    return;
  }

  loader.load(config);
}

document.addEventListener('deviceready', startLoading, false);
document.addEventListener('DOMContentLoaded', startLoading, false);

window.onerror = (message) => {
  showErrorMessage(message);
};

customSplash.create();
