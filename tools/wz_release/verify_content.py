#!/usr/bin/env python3
"""Inspect real native images for catalog icons/names, links and accepted-map art."""
import argparse
import csv
import hashlib
import json
from pathlib import Path
from native_wz import Archive, FormatError, Node, pixels, semantic_hash
from build_release import walk, node_from_spec


class Corpus:
    def __init__(self, root):
        self.root = Path(root)
        self.archives, self.images = {}, {}

    def image(self, wz, image):
        if wz not in self.archives:
            self.archives[wz] = Archive(self.root / wz)
        if (wz,image) not in self.images:
            self.images[wz,image] = self.archives[wz].image(image)
        return self.images[wz,image]

    def node(self, path):
        parts = path.split('/')
        wz = parts.pop(0)
        if not wz.endswith('.wz'):
            wz += '.wz'
        cut = next(i for i,p in enumerate(parts) if p.endswith('.img'))
        image = '/'.join(parts[:cut+1])
        node = self.image(wz,image)
        return node.get('/'.join(parts[cut+1:]))

    def resolve(self, path, seen=None):
        seen = set() if seen is None else seen
        if path in seen:
            raise FormatError(f'Alias cycle: {path}')
        seen.add(path)
        node = self.node(path)
        target = None
        if node.kind == 'uol':
            parts = path.split('/')[:-1]
            for part in str(node.value).split('/'):
                if part == '..':
                    if not parts:
                        raise FormatError('Alias escapes corpus')
                    parts.pop()
                elif part not in ('', '.'):
                    parts.append(part)
            target = '/'.join(parts)
        elif node.kind == 'canvas':
            link = node.child('_outlink') or node.child('_inlink')
            if link is not None:
                if link.name == '_outlink':
                    target = link.value
                else:
                    parts = path.split('/')
                    index = next(i for i,p in enumerate(parts) if p.endswith('.img'))
                    target = '/'.join(parts[:index + 1]) + '/' + link.value
        return self.resolve(target, seen) if target else node

    def close(self):
        for archive in self.archives.values():
            archive.close()


def item_path(itemid):
    padded = f'{itemid:08d}'
    if itemid // 1000000 == 1:
        category = {100:'Cap',101:'Accessory',102:'Accessory',103:'Accessory',104:'Coat',105:'Longcoat',
            106:'Pants',107:'Shoes',108:'Glove',109:'Shield',110:'Cape',111:'Ring',112:'Accessory',
            113:'Accessory',114:'Accessory',180:'PetEquip',181:'PetEquip',182:'PetEquip',183:'PetEquip',
            190:'TamingMob',191:'TamingMob',193:'TamingMob',194:'Dragon',195:'Dragon',196:'Dragon',197:'Dragon'}.get(itemid//10000,'Weapon')
        return f'Character/{category}/{padded}.img/info/icon'
    if itemid // 1000000 == 5:
        if itemid // 10000 == 500:
            return f'Item/Pet/{itemid}.img/info/icon'
        return f'Item/Cash/{padded[:4]}.img/{padded}/info/icon'
    category = {2:'Consume',3:'Install',4:'Etc'}.get(itemid//1000000)
    if not category:
        raise FormatError(f'Unknown item category {itemid}')
    return f'Item/{category}/{padded[:4]}.img/{padded}/info/icon'


def item_name_path(itemid):
    if itemid // 1000000 == 1:
        category = item_path(itemid).split('/')[1]
        return f'String/Eqp.img/Eqp/{category}/{itemid}/name'
    if itemid // 10000 == 500:
        return f'String/Pet.img/{itemid}/name'
    category = {2:'Consume',3:'Ins',4:'Etc',5:'Cash'}[itemid//1000000]
    # Etc.img groups names one additional level by million-digit category.
    return f'String/{category}.img/' + ('Etc/' if category == 'Etc' else '') + f'{itemid}/name'


def value(node,name,default=None):
    child=node.child(name)
    return child.value if child else default


def dependencies(root, image_path):
    refs=[]
    for path,n in walk(root):
        if n.kind == 'string' and n.name == '_outlink':
            refs.append((f'{path} outlink',n.value))
    if not image_path.startswith('Map/Map'):
        return refs
    info=root.child('info')
    if info:
        bgm=value(info,'bgm')
        if bgm and '/' in bgm:
            bank,track=bgm.split('/',1)
            refs.append(('info/bgm',f'Sound/{bank}.img/{track}'))
        mark=value(info,'mapMark')
        if mark:
            refs.append(('info/mapMark',f'Map/MapHelper.img/mark/{mark}'))
    for n in (root.child('back') or Node('','property')).children:
        bank=value(n,'bS')
        no=value(n,'no')
        if bank and no is not None:
            animated=value(n,'ani',0)
            refs.append((f'back/{n.name}',f'Map/Back/{bank}.img/{"ani" if animated else "back"}/{no}'))
    for layer in (n for n in root.children if n.name.isdigit()):
        info=layer.child('info')
        bank=value(info,'tS') if info else None
        for tile in (layer.child('tile') or Node('','property')).children:
            u,no=value(tile,'u'),value(tile,'no')
            if bank and u is not None and no is not None:
                refs.append((f'{layer.name}/tile/{tile.name}',f'Map/Tile/{bank}.img/{u}/{no}'))
        for obj in (layer.child('obj') or Node('','property')).children:
            bank=value(obj,'oS')
            levels=[value(obj,k) for k in ('l0','l1','l2')]
            if bank and all(x is not None for x in levels):
                refs.append((f'{layer.name}/obj/{obj.name}',f'Map/Obj/{bank}.img/'+ '/'.join(map(str,levels))))
    for life in (root.child('life') or Node('','property')).children:
        kind,id=value(life,'type'),value(life,'id')
        if kind in ('m','n') and id:
            refs.append((f'life/{life.name}',f'{"Mob" if kind=="m" else "Npc"}/{int(id):07d}.img'))
    for reactor in (root.child('reactor') or Node('','property')).children:
        id=value(reactor,'id')
        if id:
            refs.append((f'reactor/{reactor.name}',f'Reactor/{int(id):07d}.img'))
    return refs


def verify(native,contracts,catalog,output):
    corpus=Corpus(native)
    report={'catalog':[],'requirements':[],'dependencies':[],'gaps':[]}
    def require(path,why,kind=None,expected=None):
        try:
            node=corpus.resolve(path)
            if kind and node.kind!=kind:
                raise FormatError(f'{node.kind} != {kind}')
            if expected is not None and 'value' in expected:
                wanted=node_from_spec({'name':node.name,'type':node.kind,'value':expected['value']})
                if semantic_hash(node)!=semantic_hash(wanted):
                    raise FormatError('Exact deployed metadata value differs')
            elif node.kind == 'string' and not node.value.strip():
                raise FormatError('Empty string')
            if node.kind=='canvas':
                pixel=pixels(node)
                if not pixel:
                    raise FormatError('Empty pixels')
            return {'path':path,'why':why,'kind':node.kind,'present':True}
        except (KeyError,FormatError,StopIteration,FileNotFoundError) as e:
            gap={'path':path,'why':why,'error':str(e)}
            report['gaps'].append(gap)
            return dict(gap,present=False)
    ids=set()
    if catalog:
        with Path(catalog).open(newline='',encoding='utf-8-sig') as f:
            rows=csv.reader((line for line in f if line.strip() and not line.lstrip().startswith('#')),delimiter='\t')
            for row in rows:
                if not row[0].strip().isdigit():
                    raise FormatError('Unexpected catalog first column (requires headerless itemId rows)')
                ids.add(int(row[0].strip()))
    ids.update([2000000,5782000])
    for itemid in sorted(ids):
        report['catalog'].append({'item_id':itemid,'icon':require(item_path(itemid),'item icon'),
                                 'name':require(item_name_path(itemid),'item name','string')})
    queue=[]
    for contractpath in contracts:
        c=json.loads(Path(contractpath).read_text())
        for req in c.get('requirements',[]):
            path=f'{req["wz"]}/{req["image"]}'+('/'+req['node'] if req.get('node') else '')
            report['requirements'].append(require(path,'contract required node',req.get('type'),req))
        for req in c.get('stock_requirements', []):
            report['requirements'].append(require(req['path'], 'stock rider', None if req.get('type') == 'image' else req.get('type')))
        for op in c.get('operations',[]):
            path=f'{op["target_wz"]}/{op["target_image"]}'
            if path not in queue:
                queue.append(path)
    seen=set()
    while queue:
        path=queue.pop()
        if path in seen:
            continue
        seen.add(path)
        try:
            root=corpus.node(path)
        except (KeyError,FormatError) as e:
            report['gaps'].append(dict(path=path,why='dependency image',error=str(e)))
            continue
        normalized=path.replace('.wz/','/')
        for location,ref in dependencies(root,normalized):
            row=require(ref,f'{path}/{location}')
            report['dependencies'].append(row)
            if row['present'] and ref.endswith('.img'):
                queue.append(ref)
        # Same-image aliases must resolve relative to their parent, not as absolute file paths.
        for location,node in walk(root):
            if node.kind=='uol' or node.name=='_inlink' and node.kind=='string':
                parts=location.split('/')[:-1] if node.kind=='uol' else []
                for part in str(node.value).split('/'):
                    if part=='..':
                        if not parts:
                            report['gaps'].append(dict(path=path+'/'+location,why='alias escapes image',target=node.value))
                            break
                        parts.pop()
                    elif part not in ('','.'):parts.append(part)
                else:
                    try:root.get('/'.join(parts))
                    except KeyError:
                        report['gaps'].append(dict(path=path+'/'+location,why='unresolved in-image alias',target=node.value))
    report['catalog_item_count']=len(ids)
    report['status']='pass' if not report['gaps'] else 'gaps'
    Path(output).write_text(json.dumps(report,indent=2)+'\n')
    corpus.close()
    return report


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--native',required=True)
    p.add_argument('--contract',action='append',default=[])
    p.add_argument('--catalog')
    p.add_argument('--output',required=True)
    a=p.parse_args()
    result=verify(a.native,a.contract,a.catalog,a.output)
    print(json.dumps({'status':result['status'],'catalog_item_count':result['catalog_item_count'],'gaps':len(result['gaps'])}))
    raise SystemExit(0 if result['status']=='pass' else 2)
