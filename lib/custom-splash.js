// dom elements
let icon;
let iconContainer;
let loaderBox;
let logo;
let overlap;
let splash;
let text;

let timeout;

function checkOrientation() {
  if (window.orientation === 0 || window.orientation === 180) {
    icon.classList.add('portrait');
  } else {
    icon.classList.remove('portrait');
  }
}

window.addEventListener('orientationchange', checkOrientation);

function setProgress(value) {
  loaderBox.textContent = value;
}

function setProgressScale(scale) {
  loaderBox.style.webkitTransform = `scale(${scale})`;
  loaderBox.style.transform = `scale(${scale})`;
}

function setStatusBarHeight(height) {
  splash.style.marginTop = `${-height}px`;
}

function showLoader() {
  setProgressScale(1);
}

function hideLoader() {
  setProgressScale(0);
}

function show() {
  window.clearTimeout(timeout);
  splash.style.display = '';
  splash.style.transition = '';
  splash.style.webkitTransition = '';
  splash.style.opacity = 1;
}

function hide() {
  hideLoader();

  window.clearTimeout(timeout);
  timeout = window.setTimeout(() => {
    splash.style.transition = 'opacity 300ms linear';
    splash.style.webkitTransition = 'opacity 300ms linear';
    splash.style.opacity = 0;

    timeout = window.setTimeout(() => {
      splash.style.display = 'none';
    }, 300);
  }, 300);
}

function create() {
  splash = document.createElement('div');
  splash.id = 'ts-splash-screen';

  logo = document.createElement('div');
  logo.id = 'ts-splash-logo';
  splash.appendChild(logo);

  iconContainer = document.createElement('div');
  iconContainer.id = 'ts-splash-icon-container';
  logo.appendChild(iconContainer);

  overlap = document.createElement('div');
  overlap.id = 'ts-splash-overlap';
  iconContainer.appendChild(overlap);

  icon = document.createElement('div');
  icon.id = 'ts-splash-icon';
  iconContainer.appendChild(icon);

  loaderBox = document.createElement('div');
  loaderBox.id = 'ts-splash-loader';
  iconContainer.appendChild(loaderBox);

  text = document.createElement('div');
  text.id = 'ts-splash-logo-text';
  logo.appendChild(text);

  document.body.appendChild(splash);

  checkOrientation();
}

export default {
  create,
  show,
  hide,
  setProgress,
  showLoader,
  hideLoader,
  setStatusBarHeight
};
