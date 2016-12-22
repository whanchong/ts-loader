var ip = require('ip');
var path = require('path');
var webpack = require('webpack');

var host = ip.address();
var port = 8080;

module.exports = {
  entry: {
    'ts-loader': [
      'webpack-dev-server/client?http://' + host + ':' + port,
      './lib/index.js'
    ],
    'ts-loader.min': './lib/index.js'
  },
  output: {
    path: path.join(__dirname, 'dist'),
    filename: '[name].js'
  },
  performance: {
    hints: false
  },
  plugins: [
    new webpack.optimize.UglifyJsPlugin({
      include: /\.min\.js$/,
      minimize: true
    })
  ]
};
