#!/usr/bin/env python3
"""Author original complete Prism UI art and real item metadata, never fake imported art.

The item icon is an explicit external input, recorded separately with its source hash.
All window art is original procedural artwork (no claim of bundled/original UI bytes).
Layout/dimensions implement INTEGRATION (2).md and the DLL owner's agreed contract.
"""
import argparse
import colorsys
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from native_wz import Node, canvas, write_img, pixels, semantic_hash


def font(size):
    # Pinned installed DejaVu font; hash recorded in provenance. No platform font substitution.
    return ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', size)


def plate(no_well=False):
    im = Image.new('RGBA', (301, 406))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((0, 0, 300, 405), 9, fill='#eaf3f7', outline='#273d55', width=2)
    d.rounded_rectangle((3, 3, 297, 402), 7, fill='#fffdf5', outline='#94adc2')
    d.rounded_rectangle((5, 5, 295, 22), 5, fill='#4379a2', outline='#c9e5f1')
    d.line((10, 7, 290, 7), fill='#a9d8e9')
    d.text((14, 8), 'COLORING PRISM', font=font(11), fill='white', stroke_width=0)
    # Native controls draw five tabs in the clear y24..44 strip.
    d.rectangle((8, 48, 293, 100), fill='#edf5fc', outline='#b3c9df')
    d.line((8, 103, 293, 103), fill='#dc967d', width=2)
    d.rounded_rectangle((18, 105, 283, 241), 4, fill='#e0ebed', outline='#8b9fb0')
    d.rectangle((20, 107, 281, 239), fill='#f7fbff')
    # Original full-width preview stage, underneath the runtime character/layers.
    for y in range(107, 222):
        v = round(247 - (y - 107) * .08)
        d.line((20, y, 281, y), fill=(v, min(255, v + 4), 255, 255))
    d.line((20, 222, 281, 222), fill='#a8bbc9')
    d.rectangle((20, 223, 281, 239), fill='#dfd3bb')
    if not no_well:
        d.rounded_rectangle((18, 56, 62, 98), 3, fill='#c3d5df', outline='#7f98ae')
        d.rectangle((21, 59, 59, 95), fill='#fffdf5', outline='#e5edf0')
    for y, label in ((260, 'HUE'), (295, 'CHROMA'), (330, 'VALUE')):
        d.text((18, y - 1), label, font=font(9), fill='#2e5574')
        d.rectangle((86, y - 2, 265, y + 9), fill='#afc2d1', outline='#8199ae')
    # Toggle/restore labels and stock OK/Cancel controls are drawn by native code.
    d.line((8, 370, 293, 370), fill='#c9d6de')
    return im


def badge(kind, state):
    im = Image.new('RGBA', (14, 14))
    d = ImageDraw.Draw(im)
    selected, disabled = state == 'on', state == 'off'
    d.rounded_rectangle((0, 0, 13, 13), 2, fill=('#fff5cb' if selected else '#edf4f9'),
                        outline=('#be8b28' if selected else '#8ca2b4'))
    ink = '#a6adb1' if disabled else '#3d627c'
    if kind == 'item':
        d.polygon([(3, 9), (8, 3), (11, 2), (10, 5), (5, 10)], fill=ink)
        d.line((3, 7, 7, 11), fill=ink, width=2)
        d.line((2, 12, 5, 9), fill='#b68b4d' if not disabled else ink, width=2)
    else:
        d.polygon([(7, 2), (7, 5), (10, 4), (11, 8), (10, 11), (7, 12), (4, 11), (3, 8), (5, 5), (5, 8)],
                  fill=('#d27d32' if not disabled else ink))
        d.polygon([(7, 7), (9, 10), (7, 11), (5, 10)], fill='#fff3ac' if not disabled else '#c6cbd0')
    return im


def build(output, icon_path):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    root = Node('ColorPrism', 'property')
    images = {'backgrnd': plate(), 'backgrndLook': plate(True)}
    for name, mode in [('trackTone', 'h'), ('trackChroma', 's'), ('trackBright', 'v')]:
        im = Image.new('RGBA', (176, 8))
        for x in range(176):
            t = x / 175
            rgb = colorsys.hsv_to_rgb(t if mode == 'h' else .56,
                    t if mode == 's' else 1, t if mode == 'v' else 1)
            for y in range(8):
                im.putpixel((x, y), tuple(round(c * 255) for c in rgb) + (255,))
        images[name] = im
    root.children = [canvas(n, im) for n, im in images.items()]
    layers = Node('LayerBt', 'property')
    for kind in ('item', 'glow'):
        group = Node(kind, 'property')
        for state in ('normal', 'on', 'off'):
            im = badge(kind, state)
            images[f'LayerBt_{kind}_{state}'] = im
            group.children.append(canvas(state, im))
        layers.children.append(group)
    root.children.append(layers)
    ui = Node('ColorPrism.img', 'property', children=[root])
    icon = Image.open(icon_path).convert('RGBA')
    info = Node('info', 'property', children=[canvas('icon', icon), canvas('iconRaw', icon),
        Node('cash', 'int', 1), Node('price', 'int', 1), Node('slotMax', 'int', 100)])
    item = Node('0578.img', 'property', children=[Node('05782000', 'property', children=[info])])
    string = Node('Cash.img', 'property', children=[Node('5782000', 'property', children=[
        Node('name', 'string', 'Coloring Prism'),
        Node('desc', 'string', 'Double-click to dye equipment, item effects, skills, hair, eyes or skin. A successful apply or restore consumes one prism.')])])
    for name, node in [('ColorPrism.img', ui), ('0578.img', item), ('Cash.img', string)]:
        (output / name).write_bytes(write_img(node, 'gms'))
    for name, im in images.items():
        im.save(output / f'{name}.png')
    provenance = dict(authorship='Original BunSMS procedural UI artwork; not recovered bundled ColorPrism art.',
        specification='/root/maplestory_dump/INTEGRATION (2).md:64-116; DLL-owner confirmed paths/dimensions',
        icon_source=str(icon_path), icon_sha256=hashlib.sha256(Path(icon_path).read_bytes()).hexdigest(),
        font='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
        font_sha256=hashlib.sha256(Path('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf').read_bytes()).hexdigest(),
        layout=dict(window=[301,406], caption=[14,8], tabs=[8,24,286,21], banner=[8,48,286,53],
            preview=[20,107,262,133], item_well=[18,56,45,43], layer_badges=[[127,222],[149,222]],
            sliders_x=88, sliders_y=[260,295,330], sliders_size=[176,8], toggle_y=242,
            restore_y=353, buttons_y=374, native_control_owner='native-runtime-review.NativePrismPort'),
        semantic_hashes={n.name:semantic_hash(n) for n in (ui,item,string)})
    (output / 'authored-provenance.json').write_text(json.dumps(provenance, indent=2)+'\n')
    return provenance


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output', required=True)
    p.add_argument('--icon', required=True)
    args = p.parse_args()
    build(args.output,args.icon)
