// Source: https://github.com/inexorabletash/polyfill/blob/master/polyfill.js#L4428

// HTMLElement.dataset
// Needed for: IE10-
if (!('dataset' in document.createElement('span')) &&
    'Element' in global && Element.prototype && Object.defineProperty) {
  Object.defineProperty(Element.prototype, 'dataset', { get: function() {
    var result = Object.create(null);
    for (var i = 0; i < this.attributes.length; ++i) {
      var attr = this.attributes[i];
      if (attr.specified && attr.name.substring(0, 5) === 'data-') {
        (function(element, name) {
          var prop = name.replace(/-([a-z])/g, function(m, p) {
            return p.toUpperCase();
          });
          result[prop] = element.getAttribute('data-' + name); // Read-only, for IE8-
          Object.defineProperty(result, prop, {
            get: function() {
              return element.getAttribute('data-' + name);
            },
            set: function(value) {
              element.setAttribute('data-' + name, value);
            }});
        }(this, attr.name.substring(5)));
      }
    }
    return result;
  }});
}
