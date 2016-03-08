function objectAssign() {
  function clobber(t, s) {
    var keys = Object.keys(s);
    for (var i = 0; i < keys.length; i += 1) {
      var key = keys[i];
      t[key] = s[key];
    }
  }

  var out = {};

  for (var i = 0; i < arguments.length; i += 1) {
    var o = arguments[i];
    clobber(out, o);
  }

  return out;
}

module.exports = objectAssign;
