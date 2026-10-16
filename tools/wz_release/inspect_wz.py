#!/usr/bin/env python3
"""Read-only native WZ/IMG inventory and exact semantic-node coverage report."""
import argparse
import hashlib
import json
from pathlib import Path
from native_wz import Archive, parse_img, semantic_hash, pixels
from build_release import walk


def inspect(path, image=None, node=None, key='gms', version=83):
    path = Path(path)
    if path.suffix.lower() == '.wz':
        with Archive(path, version, key) as wz:
            if image is None:
                return {'source':str(path), 'key':key, 'version':version,
                        'images':[dict(path=p,size=e.size,checksum=e.checksum) for p,e in wz.images()]}
            root = wz.image(image)
    else:
        root, key = parse_img(path.read_bytes(), path.name)
    root = root.get(node or '')
    result = {'source':str(path),'image':image,'node':node,'key':key,
              'semantic_sha256':semantic_hash(root),'kind':root.kind,'children':[c.name for c in root.children]}
    if root.kind == 'canvas':
        result['dimensions'] = [root.value['width'],root.value['height']]
        result['pixel_sha256'] = hashlib.sha256(pixels(root)).hexdigest()
    else:
        result['canvases'] = [dict(path=p,dimensions=[n.value['width'],n.value['height']])
                              for p,n in walk(root) if n.kind == 'canvas']
    return result


if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('source')
    p.add_argument('--image')
    p.add_argument('--node')
    p.add_argument('--key',default='gms',choices=['gms','none','msea'])
    p.add_argument('--version',default=83,type=int)
    p.add_argument('--output')
    a=p.parse_args()
    result=json.dumps(inspect(a.source,a.image,a.node,a.key,a.version),indent=2)+'\n'
    if a.output:
        Path(a.output).write_text(result)
    else:
        print(result,end='')
