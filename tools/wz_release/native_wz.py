#!/usr/bin/env python3
"""Strict v83 PKG1/IMG reader/writer, with untouched image-byte preservation.

Format reference: lastbattle/MapleLib @93099ab42c3225272432c3da8942024153a5ffab
(WzBinaryReader/Writer, WzImageProperty, WzDirectory, WzMutableKey). This
independent implementation supports the v83 property types, not modern WZ/MS.
Unsupported tags, duplicate children, bad lengths and offsets fail closed.
No network access, live-tree writes, automatic repairs or fallback fake nodes.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
import io
import json
import mmap
from pathlib import Path
import struct
import zlib
from Crypto.Cipher import AES

MASK = 0xffffffff
AES_KEY = bytes.fromhex('130000000800000006000000b40000001b0000000f0000003300000052000000')
IVS = {'gms': bytes.fromhex('4d23c72b'), 'msea': bytes.fromhex('b97d63e9'), 'none': bytes(4)}


class FormatError(ValueError):
    pass


class Key:
    def __init__(self, name):
        self.name, self.data = name, bytearray()
        self.aes = AES.new(AES_KEY, AES.MODE_ECB)

    def bytes(self, size):
        if self.name == 'none':
            return bytes(size)
        while len(self.data) < size:
            self.data.extend(self.aes.encrypt(bytes(self.data[-16:]) if self.data else IVS[self.name] * 4))
        return self.data[:size]


KEYS = {name: Key(name) for name in IVS}


def cint(value):
    return struct.pack('b', value) if -127 <= value <= 127 else b'\x80' + struct.pack('<i', value)


def clong(value):
    return struct.pack('b', value) if -127 <= value <= 127 else b'\x80' + struct.pack('<q', value)


def wzstring(value, key):
    unicode = any(ord(c) > 127 for c in value)
    raw = value.encode('utf-16le' if unicode else 'ascii')
    n = len(raw) // (2 if unicode else 1)
    if not n:
        return b'\0'
    head = (struct.pack('b', n) if n < 127 else b'\x7f' + struct.pack('<i', n)) if unicode else (
        struct.pack('b', -n) if n < 128 else b'\x80' + struct.pack('<i', n))
    encrypted = bytearray(raw)
    if unicode:
        for i in range(n):
            mask = (0xaaaa + i) & 0xffff
            encrypted[i * 2] ^= mask & 255
            encrypted[i * 2 + 1] ^= mask >> 8
    else:
        for i in range(n):
            encrypted[i] ^= (0xaa + i) & 255
    stream = KEYS[key].bytes(len(raw))
    return head + bytes(v ^ stream[i] for i, v in enumerate(encrypted))


class Reader:
    def __init__(self, data, key='gms', pos=0):
        self.data, self.key, self.pos = data, key, pos

    def read(self, size):
        if size < 0 or self.pos < 0 or self.pos + size > len(self.data):
            raise FormatError(f'Truncated read at {self.pos}: {size} / {len(self.data)}')
        value = self.data[self.pos:self.pos + size]
        self.pos += size
        return value

    def unpack(self, fmt):
        return struct.unpack(fmt, self.read(struct.calcsize(fmt)))[0]

    def byte(self):
        return self.unpack('<B')

    def int(self):
        value = self.unpack('b')
        return self.unpack('<i') if value == -128 else value

    def long(self):
        value = self.unpack('b')
        return self.unpack('<q') if value == -128 else value

    def string(self):
        size = self.unpack('b')
        if not size:
            return ''
        unicode = size > 0
        n = self.unpack('<i') if size in (-128, 127) else abs(size)
        if not 0 <= n <= 10000000:
            raise FormatError(f'Invalid string length {n}')
        raw = bytearray(self.read(n * (2 if unicode else 1)))
        stream = KEYS[self.key].bytes(len(raw))
        for i in range(len(raw)):
            raw[i] ^= stream[i]
        if unicode:
            for i in range(n):
                mask = (0xaaaa + i) & 0xffff
                raw[i * 2] ^= mask & 255
                raw[i * 2 + 1] ^= mask >> 8
        else:
            for i in range(n):
                raw[i] ^= (0xaa + i) & 255
        return raw.decode('utf-16le' if unicode else 'latin1')

    def string_block(self):
        tag = self.byte()
        if tag in (0, 0x73):
            return self.string()
        if tag in (1, 0x1b):
            offset = self.unpack('<i')
            saved = self.pos
            self.pos = offset
            value = self.string()
            self.pos = saved
            return value
        raise FormatError(f'Unsupported string block {tag:#x}')


@dataclass
class Node:
    name: str
    kind: str
    value: object = None
    children: list[Node] = field(default_factory=list)

    def child(self, name):
        return next((n for n in self.children if n.name == name), None)

    def get(self, path):
        node = self
        for part in path.split('/') if path else []:
            node = node.child(part)
            if node is None:
                raise KeyError(path)
        return node

    def put(self, path, node, replace=False):
        parts = path.split('/')
        parent = self.get('/'.join(parts[:-1]))
        old = parent.child(parts[-1])
        if old is not None and not replace:
            raise FormatError(f'Node already exists: {path}')
        node.name = parts[-1]
        if old is None:
            parent.children.append(node)
        else:
            parent.children[parent.children.index(old)] = node


def png_zlib(data, key):
    if len(data) < 2:
        raise FormatError('Canvas has no compressed pixels')
    if data[:2] in (b'\x78\x9c', b'\x78\xda', b'\x78\x01', b'\x78\x5e'):
        return data
    r = Reader(data, key)
    result = bytearray()
    while r.pos < len(data):
        size = r.unpack('<i')
        block = r.read(size)
        stream = KEYS[key].bytes(size)
        result.extend(v ^ stream[i] for i, v in enumerate(block))
    if result[:2] not in (b'\x78\x9c', b'\x78\xda', b'\x78\x01', b'\x78\x5e'):
        raise FormatError('Invalid encrypted canvas zlib header')
    return bytes(result)


def pixels(node):
    if node.kind != 'canvas':
        raise FormatError('Expected canvas')
    # Native readers consume the declared pixel extent; some source exporters
    # append zero-filled buffer capacity and omit final DEFLATE/Adler32 bytes.
    value = node.value
    decoder = zlib.decompressobj(-15)
    raw = decoder.decompress(value['zlib'][2:]) + decoder.flush()
    w, h = value['width'], value['height']
    fmt = value['format'] + value['format2']
    expected = {1: w*h*2, 2: w*h*4, 257: w*h*2, 513: w*h*2,
                517: w*h//128, 1026: ((w+3)//4)*((h+3)//4)*16,
                2050: ((w+3)//4)*((h+3)//4)*16}.get(fmt)
    if expected is not None:
        if len(raw) < expected or any(raw[expected:]):
            raise FormatError(f'Canvas {node.name}: invalid pixel extent {len(raw)} / {expected} ({w}x{h}, format {fmt})')
        raw = raw[:expected]
    if expected is None and not decoder.eof:
        raise FormatError(f'Unsupported unterminated canvas format {fmt}')
    return raw


def properties(r):
    count = r.int()
    if not 0 <= count <= 1000000:
        raise FormatError(f'Invalid property count {count}')
    result, names = [], set()
    for _ in range(count):
        name = r.string_block()
        if name in names:
            raise FormatError(f'Duplicate property {name!r}')
        names.add(name)
        tag = r.byte()
        if tag == 0:
            node = Node(name, 'null')
        elif tag in (2, 11):
            node = Node(name, 'short', r.unpack('<h'))
        elif tag in (3, 19):
            node = Node(name, 'int', r.int())
        elif tag == 20:
            node = Node(name, 'long', r.long())
        elif tag == 4:
            marker = r.byte()
            if marker not in (0, 128):
                raise FormatError(f'Invalid float marker {marker}')
            node = Node(name, 'float', r.read(4) if marker else bytes(4))
        elif tag == 5:
            node = Node(name, 'double', r.read(8))
        elif tag == 8:
            node = Node(name, 'string', r.string_block())
        elif tag == 9:
            length = r.unpack('<I')
            end = r.pos + length
            node = extended(r, name, end)
            if r.pos != end:
                raise FormatError(f'Extended property length mismatch {name}: {r.pos} != {end}')
        else:
            raise FormatError(f'Unsupported property tag {tag:#x} at {r.pos}')
        result.append(node)
    return result


def extended(r, name, end=None):
    kind = r.string_block()
    if kind == 'Property':
        if r.read(2) != bytes(2):
            raise FormatError('Nonzero Property reserved field')
        return Node(name, 'property', children=properties(r))
    if kind == 'Canvas':
        reserved = r.byte()
        has = r.byte()
        if reserved or has not in (0, 1):
            raise FormatError('Unsupported Canvas header')
        children = []
        if has:
            if r.read(2) != bytes(2):
                raise FormatError('Nonzero Canvas property reserved field')
            children = properties(r)
        width, height, fmt, fmt2 = r.int(), r.int(), r.int(), r.byte()
        extra = r.read(4)
        size = r.unpack('<i')
        marker = r.byte()
        data = png_zlib(r.read(size - 1), r.key)
        return Node(name, 'canvas', dict(width=width, height=height, format=fmt, format2=fmt2,
                    reserved=extra, marker=marker, zlib=data), children)
    if kind == 'Shape2D#Vector2D':
        return Node(name, 'vector', (r.int(), r.int()))
    if kind == 'Shape2D#Convex2D':
        count = r.int()
        if not 0 <= count <= 1000000:
            raise FormatError('Invalid convex count')
        return Node(name, 'convex', children=[extended(r, str(i)) for i in range(count)])
    if kind == 'UOL':
        if r.byte() != 0:
            raise FormatError('Nonzero UOL reserved field')
        return Node(name, 'uol', r.string_block())
    if kind == 'Sound_DX8':
        if end is None:
            raise FormatError('Sound without extent')
        marker, size, duration = r.byte(), r.int(), r.int()
        header_size = end - r.pos - size
        header = r.read(header_size)
        data = r.read(size)
        return Node(name, 'sound', dict(marker=marker, duration=duration, header=header, data=data, key=r.key))
    raise FormatError(f'Unsupported extended type {kind!r}')


def parse_img(data, name='', key=None):
    errors = []
    for selected in ([key] if key else IVS):
        try:
            r = Reader(data, selected)
            if r.string_block() != 'Property' or r.read(2) != bytes(2):
                raise FormatError('Not a Property IMG')
            root = Node(name, 'property', children=properties(r))
            if r.pos != len(data):
                raise FormatError(f'Trailing IMG bytes: {len(data) - r.pos}')
            return root, selected
        except (FormatError, UnicodeError, struct.error, IndexError) as exc:
            errors.append(f'{selected}: {exc}')
    raise FormatError('; '.join(errors))


def write_properties(nodes, key):
    out = bytearray(cint(len(nodes)))
    for n in nodes:
        out += b'\0' + wzstring(n.name, key)
        if n.kind == 'null':
            out += b'\0'
        elif n.kind == 'short':
            out += b'\x02' + struct.pack('<h', n.value)
        elif n.kind == 'int':
            out += b'\x03' + cint(n.value)
        elif n.kind == 'long':
            out += b'\x14' + clong(n.value)
        elif n.kind == 'float':
            out += b'\x04\x80' + n.value
        elif n.kind == 'double':
            out += b'\x05' + n.value
        elif n.kind == 'string':
            out += b'\x08\0' + wzstring(n.value, key)
        else:
            value = write_extended(n, key)
            out += b'\x09' + struct.pack('<I', len(value)) + value
    return bytes(out)


def write_extended(n, key):
    kind = {'property': 'Property', 'canvas': 'Canvas', 'vector': 'Shape2D#Vector2D',
            'convex': 'Shape2D#Convex2D', 'sound': 'Sound_DX8', 'uol': 'UOL'}[n.kind]
    out = b'\x73' + wzstring(kind, key)
    if n.kind == 'property':
        return out + bytes(2) + write_properties(n.children, key)
    if n.kind == 'canvas':
        v = n.value
        return (out + b'\0' + (b'\x01\0\0' + write_properties(n.children, key) if n.children else b'\0')
                + cint(v['width']) + cint(v['height']) + cint(v['format']) + bytes([v['format2']])
                + v['reserved'] + struct.pack('<i', len(v['zlib']) + 1) + bytes([v['marker']]) + v['zlib'])
    if n.kind == 'vector':
        return out + cint(n.value[0]) + cint(n.value[1])
    if n.kind == 'convex':
        return out + cint(len(n.children)) + b''.join(write_extended(c, key) for c in n.children)
    if n.kind == 'uol':
        return out + b'\0\0' + wzstring(n.value, key)
    v = n.value
    # WAVEFORMAT may be List.wz-encrypted; changing key without decoding it is unsafe.
    # Stock and authored weather audio use unencrypted headers; only permit known headers.
    header = v['header']
    if v['key'] != key and len(header) >= 70:
        wave = header[52:]
        if len(wave) < 18 or struct.unpack_from('<H', wave, 16)[0] + 18 != len(wave):
            raise FormatError('Cannot safely re-key unknown/encrypted Sound_DX8 header')
    return out + bytes([v['marker']]) + cint(len(v['data'])) + cint(v['duration']) + header + v['data']


def write_img(root, key='gms'):
    return b'\x73' + wzstring('Property', key) + bytes(2) + write_properties(root.children, key)


def semantic(node):
    def plain(v):
        if isinstance(v, bytes):
            return {'sha256': hashlib.sha256(v).hexdigest(), 'size': len(v)}
        if isinstance(v, dict):
            return {k: plain(x) for k, x in v.items() if k not in ('key', 'zlib')}
        return v
    value = plain(node.value)
    if node.kind == 'canvas':
        value['pixels'] = plain(pixels(node))
    return {'name': node.name, 'kind': node.kind, 'value': value,
            'children': [semantic(c) for c in node.children]}


def semantic_hash(node):
    return hashlib.sha256(json.dumps(semantic(node), sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def version_hash(version):
    h = 0
    for c in str(version):
        h = ((h << 5) + ord(c) + 1) & MASK
    return h


def offset_mask(position, start, h):
    value = (((position - start) ^ MASK) * h - 0x581c3f6d) & MASK
    shift = value & 31
    return ((value << shift) | (value >> ((32 - shift) & 31))) & MASK


@dataclass
class Entry:
    name: str
    kind: int
    size: int = 0
    checksum: int = 0
    offset: int = 0
    children: list[Entry] = field(default_factory=list)
    replacement: bytes | None = None
    table_size: int = 0


class Archive:
    def __init__(self, path, version=83, key='gms'):
        self.path, self.version, self.key = Path(path), version, key
        self.file = self.path.open('rb')
        self.data = mmap.mmap(self.file.fileno(), 0, access=mmap.ACCESS_READ)
        if self.data[:4] != b'PKG1':
            raise FormatError(f'Not PKG1: {path}')
        self.start = struct.unpack_from('<I', self.data, 12)[0]
        self.header = self.data[:self.start]
        self.hash = version_hash(version)
        encrypted = 255
        for shift in (0, 8, 16, 24):
            encrypted ^= (self.hash >> shift) & 255
        if struct.unpack_from('<H', self.data, self.start)[0] != encrypted:
            raise FormatError(f'Not v{version}: {path}')
        self.root = Entry('', 3, children=self._directory(self.start + 2, set()))

    def _directory(self, pos, visited):
        if pos in visited:
            raise FormatError('Directory offset cycle')
        visited.add(pos)
        r = Reader(self.data, self.key, pos)
        count = r.int()
        if not 0 <= count <= 100000:
            raise FormatError('Invalid directory count')
        entries, names = [], set()
        for _ in range(count):
            tag = r.byte()
            if tag == 2:
                name_offset = r.unpack('<i') + self.start
                nr = Reader(self.data, self.key, name_offset)
                tag, name = nr.byte(), nr.string()
            elif tag in (3, 4):
                name = r.string()
            else:
                raise FormatError(f'Unsupported directory entry {tag:#x}')
            if not name or name in names or '/' in name or '\\' in name:
                raise FormatError(f'Invalid/duplicate archive entry {name!r}; wrong key?')
            names.add(name)
            size, checksum = r.int(), r.int()
            offset = (r.unpack('<I') ^ offset_mask(r.pos - 4, self.start, self.hash)) + 2 * self.start
            offset &= MASK
            if offset + size > len(self.data) or offset < self.start:
                raise FormatError(f'Out-of-bounds image/directory {name}: {offset}+{size}')
            entries.append(Entry(name, tag, size, checksum, offset))
        for e in entries:
            if e.kind == 3:
                e.children = self._directory(e.offset, visited)
        return entries

    def entry(self, path, create_dirs=False):
        node = self.root
        for part in path.split('/') if path else []:
            child = next((c for c in node.children if c.name == part), None)
            if child is None and create_dirs:
                child = Entry(part, 3)
                node.children.append(child)
            if child is None:
                raise KeyError(path)
            node = child
        return node

    def images(self, directory=None, prefix=''):
        for e in (directory or self.root).children:
            path = f'{prefix}/{e.name}'.lstrip('/')
            if e.kind == 4:
                yield path, e
            else:
                yield from self.images(e, path)

    def raw(self, entry):
        return entry.replacement if entry.replacement is not None else self.data[entry.offset:entry.offset + entry.size]

    def image(self, path):
        return parse_img(self.raw(self.entry(path)), path, self.key)[0]

    def put_image(self, path, blob, replace=False):
        parts = path.split('/')
        parent = self.entry('/'.join(parts[:-1]), True)
        old = next((e for e in parent.children if e.name == parts[-1]), None)
        if old and not replace:
            raise FormatError(f'Image already exists {path}')
        if not old:
            old = Entry(parts[-1], 4)
            parent.children.append(old)
        old.replacement = blob
        old.size, old.checksum = len(blob), sum(blob) & MASK
        if old.checksum >= 0x80000000:
            old.checksum -= 0x100000000

    def save(self, output):
        output = Path(output)
        if output.resolve() == self.path.resolve():
            raise ValueError('Never overwrite an input WZ')
        def measure(directory):
            for e in directory.children:
                if e.kind == 3:
                    measure(e)
            directory.table_size = len(cint(len(directory.children))) + sum(
                1 + len(wzstring(e.name, self.key)) + len(cint(e.size)) + len(cint(e.checksum)) + 4
                for e in directory.children)
            directory.size = directory.table_size + sum(e.size for e in directory.children)
        measure(self.root)
        position = self.start + 2
        def dirs(directory):
            nonlocal position
            directory.offset = position
            position += directory.table_size
            for e in directory.children:
                if e.kind == 3:
                    dirs(e)
        dirs(self.root)
        image_positions, offsets_by_entry = {}, {}
        for path, e in self.images():
            image_positions[path] = position
            offsets_by_entry[id(e)] = position
            position += e.size
        def table(directory, out):
            if out.tell() != directory.offset:
                raise FormatError('Directory layout drift')
            out.write(cint(len(directory.children)))
            for e in directory.children:
                out.write(bytes([e.kind]) + wzstring(e.name, self.key) + cint(e.size) + cint(e.checksum))
                target = e.offset if e.kind == 3 else offsets_by_entry[id(e)]
                enc = ((target - 2 * self.start) & MASK) ^ offset_mask(out.tell(), self.start, self.hash)
                out.write(struct.pack('<I', enc))
            for e in directory.children:
                if e.kind == 3:
                    table(e, out)
        with output.open('wb') as out:
            header = bytearray(self.header)
            struct.pack_into('<Q', header, 4, position - self.start)
            out.write(header)
            out.write(self.data[self.start:self.start + 2])
            table(self.root, out)
            for path, e in self.images():
                if out.tell() != image_positions[path]:
                    raise FormatError('Image layout drift')
                out.write(self.raw(e))

    def close(self):
        self.data.close()
        self.file.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
