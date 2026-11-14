# engawa-bot: Bun + Chromium (driven through Bun.WebView).
FROM oven/bun:1.4.4

# Chromium for Bun.WebView, and fonts so names in the recording render
# (Japanese included).
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium fonts-noto-cjk fonts-noto-color-emoji ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV BUN_CHROME_PATH=/usr/bin/chromium \
    # Chromium's sandbox needs privileges a container does not have, and
    # /dev/shm is small by default.
    CHROME_FLAGS="--no-sandbox --disable-dev-shm-usage" \
    DATA_DIR=/app/data

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .

CMD ["bun", "src/main.ts"]
