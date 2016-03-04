var webpack = require('webpack');
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
}, function(error, stats) {
  var compilationErrors = stats.compilation.errors;

  error = error || compilationErrors.length && compilationErrors;

  if (error) {
    return console.error(error);
  }

  console.log('[' + new Date() + '] Built in ' + (stats.endTime - stats.startTime) + 'ms.');
});
