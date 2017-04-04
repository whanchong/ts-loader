# ts-loader
Loader for web and Cordova app. The loader will load the files based on a manifest file. The files are written on the persistent storage of the app. The loader creates the relevant DOM nodes to load and start the app.

## Quick Start

`npm run build` - Build ts-loader.js and ts-loader.min.js

`npm run start` - For development

Run the example at `http://localhost:8080/example/`

The loader need a [manifest file](#manifest-file) to determine what files to load.

## Manifest File
The manifest file should be named `app-manifest.json`. It should contains the following data:

- `manifestVersion` - the current version of the manifest
- `domNodes` - an array of file path and file type that will be append to the document (js or css file)
- `files` - a map of all the files to be preload

Example:
```json
{
  "manifestVersion": "2.1.0",
  "domNodes": [
    {
      "path": "scripts/test.js",
      "type": "js",
      "optional": true
    }
    {
      "path": "assets/app.js",
      "type": "js"
    },
    {
      "path": "assets/app.css",
      "type": "css"
    }
  ],
  "files": {
    "scripts/test.js": {
      "hash": "16b96a3c504dd0654252e577c573ef33",
      "name": "test.js",
      "path": "scripts/test.js",
      "size": 12000,
      "type": "js"
    },
    "assets/app.js": {
      "hash": "d7d6575842965b31c1ea8d37631b8178",
      "name": "app.js",
      "path": "assets/app.js",
      "size": 56442,
      "type": "js"
    },
    "assets/app.css": {
      "hash": "27d657584296q131c1a8d376131b8178",
      "name": "app.css",
      "path": "assets/app.css",
      "size": 26452,
      "type": "css"
    },
    "assets/icon.svg": {
      "hash": "ca309d960f602b3ae3dc1ef30f0db321",
      "name": "icon.svg",
      "path": "assets/icon.svg",
      "size": 1605,
      "type": "svg"
    }
  }
}
```

## Config
Config can be passed via data attributes.

```html
<script type="text/javascript" src="scripts/ts-loader.js"
data-app-host="https://app.example.com"
data-rewrite-sourcemaps="true"></script>
```
The available config are:

Name | Type | Default | Description
------------ | ------------- | ------------- | -------------
appHost | string | null |
manifestFile | | | |
performHash | | | |
publicPath | | | |
rewriteSourcemaps | | | |
statusBarBackgroundColor | | | |
supportedManifestVersion | | | |
useLocalCache | | | |

## Loader
``` html
<div id="ts-splash-screen">
  <div id="ts-splash-logo">
    <div id="ts-splash-icon-container">
      <div id="ts-splash-overlap"></div>
      <div id="ts-splash-icon"></div>
      <div id="ts-splash-loader"></div>
    </div>
    <div id="ts-splash-logo-text"></div>
  </div>
</div>
```
