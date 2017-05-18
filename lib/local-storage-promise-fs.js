import LZString from 'lz-string';

const ls = typeof window !== 'undefined' ? window.localStorage : {
  getItem: () => { throw new Error('lspfs not available'); },
  setItem: () => { throw new Error('lspfs not available'); }
};

const prefix = 'lspfs:';

const NOT_FOUND_ERR = 1;

function Writer(path, onerror) {
  this.onwriteend = () => undefined;
  this.onerror = onerror;
  this.write = (blob) => {
    const fileReader = new FileReader();

    fileReader.onload = (e) => {
      const compressed = LZString.compressToUTF16(e.target.result);

      try {
        ls.setItem(prefix + path, compressed);
      } catch (err) {
        this.onerror(err);
      }

      this.onwriteend();
    };

    fileReader.onerror = this.onerror;

    fileReader.readAsText(blob);
  };
}

function File(path) {
  this.createWriter = (cb, onerror) => {
    cb(new Writer(path, onerror));
  };
}

function dir(path) {
  return Promise.resolve({ nativeURL: path });
}

function dirname() {
  return Promise.resolve();
}

function ensure() {
  return Promise.resolve();
}

function exists(path) {
  return Promise.resolve(ls[prefix + path]);
}

function file(path) {
  return Promise.resolve(new File(path));
}

function toURL(path) {
  return Promise.resolve(`/${path}`);
}

function read(path) {
  const compressed = ls.getItem(prefix + path);

  if (compressed === null) {
    const error = new Error(`no such file or directory '${path}'`);
    error.code = NOT_FOUND_ERR;

    return Promise.reject(error);
  }

  const decompressed = LZString.decompressFromUTF16(compressed);

  return Promise.resolve(decompressed);
}

function write(path, blob) {
  return ensure(dirname(path))
    .then(() => file(path, { create: true }))
    .then((fileEntry) => {
      return new Promise((resolve, reject) => {
        fileEntry.createWriter((writer) => {
          writer.onwriteend = resolve;
          writer.onerror = reject;
          writer.write(blob);
        }, reject);
      });
    });
}

function readJSON(path) {
  return read(path).then(content => JSON.parse(content));
}

function remove() {
  return Promise.resolve();
}

export default {
  dir,
  dirname,
  ensure,
  exists,
  file,
  read,
  write,
  readJSON,
  remove,
  toURL
};
