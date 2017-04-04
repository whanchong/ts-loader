function hasBlob() {
  try {
    return !!new Blob();
  } catch (e) {
    return false;
  }
}

function hasFileReader() {
  try {
    return !!new FileReader();
  } catch (e) {
    return false;
  }
}

var hasSupportedBrowserFeatures = hasBlob() && hasFileReader();

module.exports = hasSupportedBrowserFeatures;
