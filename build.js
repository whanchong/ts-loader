var webpack = require('webpack');
var Promise = require('q').Promise;
var all = require('q').all;
var throat = require('throat');

function build(config) {
  return new Promise(function (resolve, require) {
    webpack(config).run(function (error, stats) {
      var compilationErrors = stats.compilation.errors;

      error = error || compilationErrors.length && compilationErrors;

      if (error) {
        return reject(error);
      }
      resolve({ file: config.output.filename, duration: stats.endTime - stats.startTime });
    });
  });
}

var configs = [
  {
    entry: './lib/index.js',
    output: {
      filename: './dist/ts-loader.js'
    },
    plugins: []
  },
  {
    entry: './lib/index.js',
    output: {
      filename: './dist/ts-loader.min.js'
    },
    plugins: [new webpack.optimize.UglifyJsPlugin({ minimize: true })]
  }
];

all(configs.map(throat(1, build))).then(function (results) {
  results.forEach(function (result) {
    console.log('Built', result.file, 'in', result.duration, 'msec.');
  });
  process.exit(0);
}, function (error) {
  console.error(error);
  process.exit(1);
});
