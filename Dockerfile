FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NPM_CONFIG_FETCH_RETRIES=5
ENV NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000
ENV NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8000
ENV NPM_CONFIG_FETCH_RETRIES=5
ENV NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000
ENV NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000
ENV SKILLPRINT_MOVEMENT_PYTHON=/opt/movement/bin/python
ARG INSTALL_RTMW3D_COMPAT=false
COPY requirements-movement*.txt ./
RUN if [ "$INSTALL_RTMW3D_COMPAT" = "true" ]; then \
      apt-get update && apt-get install -y --no-install-recommends python3-venv libgl1 libglib2.0-0 && \
      rm -rf /var/lib/apt/lists/* && python3 -m venv /opt/movement && \
      /opt/movement/bin/pip install -r requirements-movement.txt && \
      /opt/movement/bin/pip install --no-deps -r requirements-movement-adapter.txt; \
    fi
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/config.json ./config.json
COPY --from=build /app/public ./public
COPY --from=build /app/lessons ./lessons
COPY --from=build /app/src/movement ./src/movement
EXPOSE 8000
CMD ["node", "dist/server/index.js"]
