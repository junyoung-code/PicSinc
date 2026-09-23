# Build context is the repository root: docker build -f picsinc-merge/Dockerfile .
FROM node:22-bookworm-slim AS web
WORKDIR /app/picsinc-merge
ENV NEXT_TELEMETRY_DISABLED=1
COPY picsinc-merge/package.json picsinc-merge/package-lock.json ./
RUN npm ci
COPY picsinc-merge/ ./
RUN npm run build && npm prune --omit=dev

FROM python:3.12.13-slim-bookworm AS runtime
COPY --from=web /usr/local/bin/node /usr/local/bin/node
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 \
    YOLO_RUNTIME_DIR=/app/yolo YOLO_PYTHON=/opt/yolo/bin/python PYTHONUNBUFFERED=1 \
    OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 libgl1 libglib2.0-0 ca-certificates && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/yolo && useradd --uid 1000 --create-home node
COPY picsinc-merge/deploy/requirements.txt /tmp/requirements.txt
RUN /opt/yolo/bin/pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu -r /tmp/requirements.txt
WORKDIR /app/picsinc-merge
COPY --from=web --chown=node:node /app/picsinc-merge/.next ./.next
COPY --from=web --chown=node:node /app/picsinc-merge/public ./public
COPY --from=web --chown=node:node /app/picsinc-merge/node_modules ./node_modules
COPY --from=web --chown=node:node /app/picsinc-merge/package.json ./package.json
COPY --chown=node:node experiments/yolo-outline/outline.py experiments/yolo-outline/overlap.py experiments/yolo-outline/export_regions.py /app/yolo/
# Freeze the already verified public model in the image; requests need no model download.
COPY --chown=node:node experiments/yolo-outline/.cache/yolo26n-seg.pt /app/yolo/.cache/yolo26n-seg.pt
RUN mkdir -p /app/yolo/.cache/ultralytics /app/yolo/.cache/matplotlib && chown -R node:node /app/yolo
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
