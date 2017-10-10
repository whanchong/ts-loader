export default class DomNode {
  constructor(nodeInfo) {
    const type = nodeInfo.type;

    if (type === 'js') {
      return this.createRemoteNode(nodeInfo, 'script', {
        type: 'text/javascript'
      });
    }

    if (type === 'css') {
      return this.createRemoteNode(nodeInfo, 'link', {
        type: 'text/css',
        rel: 'stylesheet'
      });
    }

    throw new Error(`Unknown node type: ${type}`);
  }

  updateNodeAttributes = (node, attributes) => {
    if (attributes) {
      Object.keys(attributes).forEach((key) => {
        node.setAttribute(key, attributes[key]);
      });
    }
  };

  createRemoteNode = (nodeInfo, element, attributes) => {
    return new Promise((resolve, reject) => {
      const node = document.createElement(element);

      this.updateNodeAttributes(node, attributes);
      this.updateNodeAttributes(node, nodeInfo.attributes);

      node.onload = resolve;

      node.onerror = (error) => {
        if (nodeInfo.optional) {
          return resolve();
        }
        console.error('error loading: ', nodeInfo, error);
        return reject(error);
      };

      node.setAttribute(element === 'script' ? 'src' : 'href', nodeInfo.path);

      document.body.appendChild(node);
    });
  };
}
