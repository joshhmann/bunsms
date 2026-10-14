"""Real Journey decoder/playback regressions; run: python3 -m unittest test_movement -v."""
import io
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest


class MovementTests(unittest.TestCase):
    def test_decoded_movement_trajectories(self):
        root = Path(__file__).resolve().parent
        vendor = root / 'vendor/maplestory-wasm'
        base = '8eece1d1fc43afa48e12df56b4719ca63af88e0b'
        archive = subprocess.run(
            ['git', '-C', str(vendor), 'archive', '--format=tar', base],
            check=True, capture_output=True,
        ).stdout
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp)
            with tarfile.open(fileobj=io.BytesIO(archive)) as snapshot:
                snapshot.extractall(source, filter='data')
            patch = root / 'patches/remote-movement.patch'
            subprocess.run(['git', 'apply', '--check', str(patch)], cwd=source, check=True)
            subprocess.run(['git', 'apply', str(patch)], cwd=source, check=True)
            client = source / 'src/client'
            binary = source / 'movement-test'
            subprocess.run([
                'g++', '-std=c++17', '-Wall', '-Wextra', '-Werror', '-O2',
                '-I', str(client), '-I', str(source / 'src'),
                str(root / 'test_movement.cpp'), str(client / 'Net/InPacket.cpp'),
                str(client / 'Net/Handlers/Helpers/MovementParser.cpp'),
                '-o', str(binary),
            ], check=True)
            subprocess.run([str(binary)], check=True)


if __name__ == '__main__':
    unittest.main()
