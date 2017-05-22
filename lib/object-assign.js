function objectAssign(...args) {
  function clobber(t, s) {
    const keys = Object.keys(s);
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      t[key] = s[key];
    }
  }

  const out = {};

  for (let i = 0; i < args.length; i += 1) {
    const o = args[i];
    clobber(out, o);
  }

  return out;
}

export default objectAssign;
