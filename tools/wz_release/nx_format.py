"""Strict PKG4 inspection using the deployed nlnx file/node record layout.

Format authority: vendor/maplestory-wasm/src/nlnx/{file_impl,node_impl}.hpp,
node.cpp and NoLifeWzToNx write_strings/write_audio/write_bitmaps. Canvas
payloads are length-prefixed LZ4 blocks; audio lengths live on their nodes.
No WZ parsing, replacement art, or production I/O is performed here.
"""
from __future__ import annotations

import ctypes
import ctypes.util
import hashlib
import mmap
import struct
from functools import lru_cache
from pathlib import Path

HEADER = struct.Struct('<IIQIQIQIQ')
NODE = struct.Struct('<IIHH8s')
U32 = struct.Struct('<I')
U64 = struct.Struct('<Q')


class NXError(ValueError):
    pass


class NX:
    def __init__(self, path):
        self.path = Path(path)
        self.stream = self.path.open('rb')
        self.data = mmap.mmap(self.stream.fileno(), 0, access=mmap.ACCESS_READ)
        self.size = len(self.data)
        self.bounds(0, HEADER.size)
        (magic, self.node_count, self.node_offset, self.string_count,
         self.string_offset, self.bitmap_count, self.bitmap_offset,
         self.audio_count, self.audio_offset) = HEADER.unpack_from(self.data)
        if magic != 0x34474B50 or not self.node_count:
            raise NXError(f'{self.path}: not a populated PKG4 NX')
        for count, offset, width in ((self.node_count, self.node_offset, 20),
                                     (self.string_count, self.string_offset, 8),
                                     (self.bitmap_count, self.bitmap_offset, 8),
                                     (self.audio_count, self.audio_offset, 8)):
            self.bounds(offset, count * width)
        self._payload_hashes = {}

    def close(self):
        self.string.cache_clear()
        self.data.close()
        self.stream.close()

    def bounds(self, offset, length):
        if offset < 0 or length < 0 or offset + length > self.size:
            raise NXError(f'{self.path}: out-of-file range {offset}+{length}/{self.size}')

    def table_offset(self, kind, index):
        count, start = {'string': (self.string_count, self.string_offset),
                        'bitmap': (self.bitmap_count, self.bitmap_offset),
                        'audio': (self.audio_count, self.audio_offset)}[kind]
        if not 0 <= index < count:
            raise NXError(f'{self.path}: invalid {kind} index {index}/{count}')
        return U64.unpack_from(self.data, start + index * 8)[0]

    @lru_cache(maxsize=131072)
    def string(self, index):
        offset = self.table_offset('string', index)
        self.bounds(offset, 2)
        length = struct.unpack_from('<H', self.data, offset)[0]
        self.bounds(offset + 2, length)
        value = self.data[offset + 2:offset + 2 + length]
        value.decode('utf-8', errors='strict')
        return value

    def record(self, index):
        if not 0 <= index < self.node_count:
            raise NXError(f'{self.path}: invalid node {index}/{self.node_count}')
        record = NODE.unpack_from(self.data, self.node_offset + index * 20)
        name, first, count, kind, _ = record
        self.string(name)
        if kind > 6 or (count and first + count > self.node_count):
            raise NXError(f'{self.path}: invalid node record {index}: {record[:4]}')
        return record

    def name(self, index):
        return self.string(self.record(index)[0]).decode('utf-8')

    def child_entries(self, index, validate_sorted=True):
        """Return every physical child, retaining equal-name source order."""
        _, first, count, _, _ = self.record(index)
        result = []
        previous = None
        for child in range(first, first + count):
            name = self.name(child)
            encoded = name.encode('utf-8')
            if validate_sorted and previous is not None and encoded < previous:
                raise NXError(f'{self.path}: unsorted siblings at node {index}: {name!r}')
            previous = encoded
            result.append((name, child))
        return result

    def children(self, index):
        """Unique-name view for callers that explicitly require dictionary keys."""
        result = {}
        for name, child in self.child_entries(index):
            if name in result:
                raise NXError(f'{self.path}: duplicate {name!r} cannot use a dictionary view at node {index}')
            result[name] = child
        return result

    def resolve(self, path, index=0):
        """Match nlnx/node.cpp get_child's exact midpoint binary-search lookup."""
        for part in path.split('/') if path else ():
            key = part.encode('utf-8')
            _, first, count, _, _ = self.record(index)
            while count:
                half = count >> 1
                candidate = first + half
                name = self.string(self.record(candidate)[0])
                if name < key:
                    first = candidate + 1
                    count -= half + 1
                elif name > key:
                    count = half
                else:
                    index = candidate
                    break
            else:
                return None
        return index

    def value(self, index):
        _, _, _, kind, data = self.record(index)
        if kind == 1:
            return struct.unpack('<q', data)[0]
        if kind == 2:
            return struct.unpack('<d', data)[0]
        if kind == 3:
            return self.string(U32.unpack_from(data)[0]).decode('utf-8')
        if kind == 4:
            return struct.unpack('<ii', data)
        if kind in (5, 6):
            return struct.unpack('<IHH' if kind == 5 else '<II', data)
        return None

    def payload(self, index):
        _, _, _, kind, data = self.record(index)
        number = U32.unpack_from(data)[0]
        if kind == 5:
            offset = self.table_offset('bitmap', number)
            self.bounds(offset, 4)
            length = U32.unpack_from(self.data, offset)[0] + 4
        elif kind == 6:
            offset = self.table_offset('audio', number)
            length = U32.unpack_from(data, 4)[0]
        else:
            raise NXError('Payload requested for non-media node')
        self.bounds(offset, length)
        if length <= (4 if kind == 5 else 0):
            raise NXError(f'{self.path}: empty media payload at node {index}')
        return offset, length

    def semantic_value(self, index):
        _, _, _, kind, data = self.record(index)
        if kind == 3:
            data = self.string(U32.unpack_from(data)[0])
        elif kind in (5, 6):
            offset, length = self.payload(index)
            key = (offset, length)
            if key not in self._payload_hashes:
                self._payload_hashes[key] = hashlib.sha256(memoryview(self.data)[offset:offset + length]).digest()
            data = data[4:] + self._payload_hashes[key]
        elif kind == 0:
            data = b''  # none's unused union bytes are not runtime values
        return struct.pack('<HI', kind, len(data)) + data

    def validate_graph(self):
        # Resolved UOLs share child ranges, including backward references.
        # Only cycles are invalid; a topologically ordered tree is not required.
        state = bytearray(self.node_count)
        stack = [(0, False)]
        while stack:
            index, exiting = stack.pop()
            if exiting:
                state[index] = 2
                continue
            if state[index] == 1:
                raise NXError(f'{self.path}: cyclic NX graph at node {index}')
            if state[index] == 2:
                continue
            state[index] = 1
            _, first, count, _, _ = self.record(index)
            stack.append((index, True))
            stack.extend((child, False) for child in range(first, first + count))

    def walk(self, index=0, path='', ancestors=frozenset()):
        if index in ancestors:
            raise NXError(f'{self.path}: cyclic NX graph at {path}')
        yield path, index
        ancestors = ancestors | {index}
        for name, child in self.child_entries(index):
            yield from self.walk(child, f'{path}/{name}'.lstrip('/'), ancestors)

    def semantic_hash(self, index):
        digest = hashlib.sha256()
        count = 0
        for path, child in self.walk(index):
            encoded = path.encode('utf-8')
            digest.update(struct.pack('<I', len(encoded)))
            digest.update(encoded)
            digest.update(self.semantic_value(child))
            count += 1
        return {'sha256': digest.hexdigest(), 'nodes': count}

    def canvas(self, index):
        number, width, height = self.value(index)
        if not width or not height:
            raise NXError(f'{self.path}: zero-sized canvas at node {index}')
        offset, length = self.payload(index)
        size = width * height * 4
        if size > 512 * 1024 * 1024:
            raise NXError(f'{self.path}: canvas exceeds nlnx signed-size safety bound')
        compressed = self.data[offset + 4:offset + length]
        pixels = ctypes.create_string_buffer(size)
        actual = lz4().LZ4_decompress_safe(compressed, pixels, len(compressed), size)
        if actual != size:
            raise NXError(f'{self.path}: malformed LZ4 canvas {index}: {actual}, expected {size}')
        raw = pixels.raw
        return {'width': width, 'height': height, 'compressed_size': length - 4,
                'payload_sha256': hashlib.sha256(self.data[offset:offset + length]).hexdigest(),
                'bgra_sha256': hashlib.sha256(raw).hexdigest(),
                'visible': any(raw[3::4]), 'bitmap_index': number}

    def inspect(self, path, visual=False):
        index = self.resolve(path)
        if index is None:
            return {'path': path, 'status': 'missing', 'nodes': 0, 'canvases': 0, 'audio': 0}
        result = {'path': path, 'status': 'present', 'nodes': 0, 'canvases': 0,
                  'audio': 0, 'visible_canvases': 0, 'canvas_evidence': []}
        for relative, child in self.walk(index):
            result['nodes'] += 1
            kind = self.record(child)[3]
            self.semantic_value(child)  # validate string/media references, not names alone
            if kind == 5:
                result['canvases'] += 1
                canvas = self.canvas(child)
                canvas['node'] = relative
                result['visible_canvases'] += int(canvas['visible'])
                result['canvas_evidence'].append(canvas)
            elif kind == 6:
                result['audio'] += 1
        result['semantic'] = self.semantic_hash(index)
        if visual and not result['visible_canvases']:
            result['status'] = 'missing-visible-art'
        return result


@lru_cache(maxsize=1)
def lz4():
    library = ctypes.util.find_library('lz4')
    if not library:
        raise NXError('liblz4 is required for actual canvas inspection (no packages installed automatically)')
    lib = ctypes.CDLL(library)
    lib.LZ4_decompress_safe.argtypes = [ctypes.c_char_p, ctypes.c_void_p, ctypes.c_int, ctypes.c_int]
    lib.LZ4_decompress_safe.restype = ctypes.c_int
    return lib


def file_identity(path):
    path = Path(path)
    with path.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    return {'name': path.name, 'size': path.stat().st_size, 'sha256': digest, 'source': str(path.resolve())}
