"""Run the production aiohttp applications on isolated loopback/Unix test endpoints."""
import asyncio
import importlib.util
import json
import pathlib
import signal
from aiohttp import web

source = pathlib.Path(__file__).resolve().parents[2] / 'web-client' / 'server.py'
spec = importlib.util.spec_from_file_location('asset_http_server', source)
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


async def main():
    runner = web.AppRunner(server.build_app())
    await runner.setup()
    site = web.TCPSite(runner, '127.0.0.1', 0)
    await site.start()
    print(json.dumps({'port': site._server.sockets[0].getsockname()[1]}), flush=True)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    loop.add_signal_handler(signal.SIGTERM, stop.set)
    await stop.wait()
    await runner.cleanup()


asyncio.run(main())
