import throater from 'throat';
import DomNode from './DomNode';

const throat = throater(Promise);

export default function browserLoad(serverRoot = '', manifest, onProgress) {
  let completedCount = 0;
  return Promise.all(manifest.domNodes.map(throat(1, (nodeInfo) => {
    if (!nodeInfo.path.match(/^http(s|):\/\//)) {
      nodeInfo.path = `${serverRoot}${nodeInfo.path}`;
    }
    return new DomNode(nodeInfo).then(() => {
      completedCount += 1;
      onProgress({ queueIndex: completedCount, queueSize: manifest.domNodes.length });
    });
  })));
}
