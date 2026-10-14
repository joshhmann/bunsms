# ---- Stage 1: build the WASM client from source ----
# Source is pinned via the git submodule at vendor/maplestory-wasm.
FROM emscripten/emsdk:4.0.21 AS builder

WORKDIR /wasm

# Copy just the repo checkout. We don't need the .git directory at build time.
COPY vendor/maplestory-wasm/ /wasm/
COPY patches/remote-movement.patch /tmp/remote-movement.patch

RUN git apply --check /tmp/remote-movement.patch \
    && git apply /tmp/remote-movement.patch \
    && ./scripts/build_wasm.sh -j 8

# ---- Stage 2: aiohttp runtime (static files + WS TCP proxy) ----
FROM python:3.11-slim AS runtime

WORKDIR /app
RUN pip install --no-cache-dir aiohttp==3.10.5

# Server code and config overrides ship from the augurms repo.
COPY server.py /app/server.py
COPY web/config.prod.json /app/web/config.json

# Pull the patched engine from the build stage and retain the BunSMS routing shell.
COPY --from=builder /wasm/build/JourneyClient.js   /app/build/JourneyClient.js
COPY --from=builder /wasm/build/JourneyClient.wasm /app/build/JourneyClient.wasm
COPY web/index.html                              /app/web/index.html
COPY web/prefetcher.js                            /app/web/prefetcher.js
COPY web/logo.png                                 /app/web/logo.png

ENV STATIC_ROOT=/app
ENV PORT=8080
EXPOSE 8080

CMD ["python", "-u", "server.py"]
