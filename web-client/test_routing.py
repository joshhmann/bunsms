"""Journey HTTP/WS routing regressions; run: python3 -m unittest test_routing -v."""
import asyncio
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from aiohttp import WSMsgType
from aiohttp.test_utils import TestClient, TestServer

import server


class RoutingTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.root = Path(__file__).resolve().parent
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        Path(self.temp.name, 'probe.nx').write_bytes(b'PKG4range-probe')
        self.connections = 0

        async def count_connection(_reader, writer):
            self.connections += 1
            writer.close()
            await writer.wait_closed()

        self.tcp = await asyncio.start_server(count_connection, '127.0.0.1', 0)
        self.addAsyncCleanup(self.close_tcp)
        self.target = '127.0.0.1:' + str(self.tcp.sockets[0].getsockname()[1])
        self.settings = patch.multiple(
            server, STATIC_ROOT=str(self.root),
            INDEX_HTML=str(self.root / 'web/index.html'),
            NX_LOCAL_DIR=self.temp.name, ALLOWED_TARGETS=set(),
        )
        self.settings.start()
        self.addCleanup(self.settings.stop)
        self.client = TestClient(TestServer(server.build_app()))
        await self.client.start_server()
        self.addAsyncCleanup(self.client.close)

    async def close_tcp(self):
        self.tcp.close()
        await self.tcp.wait_closed()

    async def test_page_config_and_build_revalidate(self):
        for path in ('/', '/web/index.html', '/web/config.json', '/build/JourneyClient.js'):
            response = await self.client.get(path)
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers.get('Cache-Control'), 'no-cache, must-revalidate')
            await response.read()

    async def test_denied_target_never_dials(self):
        ws = await self.client.ws_connect('/')
        await ws.send_bytes(self.target.encode())
        message = await ws.receive(timeout=2)
        self.assertEqual(message.type, WSMsgType.CLOSE)
        self.assertEqual(self.connections, 0)
        await ws.close()

    async def test_nx_range(self):
        response = await self.client.get('/nx/probe.nx', headers={'Range': 'bytes=4-8'})
        self.assertEqual(response.status, 206)
        self.assertEqual(response.headers['Content-Range'], 'bytes 4-8/15')
        self.assertEqual(response.headers['Access-Control-Allow-Origin'], '*')
        self.assertEqual(await response.read(), b'range')


if __name__ == '__main__':
    unittest.main()
