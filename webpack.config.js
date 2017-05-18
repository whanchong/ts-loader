const ip = require('ip');
const path = require('path');
const webpack = require('webpack');

const host = ip.address();
const port = 8080;

module.exports = {
  entry: {
    'ts-loader': [
      'webpack-dev-server/client?http://' + host + ':' + port,
      'babel-polyfill',
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
  ],
  module: {
    rules: [
      {
        test: /\.js$/,
        loader: 'babel-loader',
        exclude: /(node_modules|bower_components)/,
        query: {
          cacheDirectory: true
        }
      }
    ]
  }
};
