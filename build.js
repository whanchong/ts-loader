var webpack = require('webpack');
var semver = require('semver');
var fs = require('q-io/fs');
var fork = require('child_process').fork;

var PROD = process.argv[2]

var compiler = webpack({
  entry: './lib/index.js',
  output: {
    filename: './dist/ts-loader.js'
  },
  plugins: PROD ? [
    new webpack.optimize.UglifyJsPlugin({ minimize: true })
  ] : []
});

compiler.watch({
  aggregateTimeout: 300,
  poll: true
}, function(err, stats) {
  var compilationErrors = stats.compilation.errors;
  err = err || compilationErrors.length && compilationErrors;
  if (err) {
    return console.log(err);
  }
  console.log('build', new Date());

  var config, appSettings;

  fs.read('./package.json').then(function (packageContent) {
    try {
      config =  JSON.parse(packageContent);
    } catch (e) {
      throw 'error while parsing package.json';
    }
  }).catch(function (e) {
    console.error(e);
  });
});
