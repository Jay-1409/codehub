FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build && npm prune --omit=dev


FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV ORACLE_DRIVER_MODE=thick
ENV ORACLE_BASE=/opt/oracle
ENV INSTANT_CLIENT_PATH=/opt/oracle/instantclient
ENV LD_LIBRARY_PATH=/opt/oracle/instantclient

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        unzip \
        libaio1 \
        libnsl2 \
        tini \
    && rm -rf /var/lib/apt/lists/*

ARG IC_ZIP_URL=https://download.oracle.com/otn_software/linux/instantclient/2380000/instantclient-basic-linux.x64-23.8.0.25.04.zip
RUN mkdir -p /opt/oracle \
    && curl -fsSL "$IC_ZIP_URL" -o /tmp/instantclient-basic.zip \
    && unzip -oq /tmp/instantclient-basic.zip -d /opt/oracle \
    && rm -f /tmp/instantclient-basic.zip \
    && IC_DIR="$(find /opt/oracle -maxdepth 1 -type d -name 'instantclient_*' | sort -V | tail -n 1)" \
    && test -n "$IC_DIR" \
    && ln -sfn "$IC_DIR" /opt/oracle/instantclient \
    && cd /opt/oracle/instantclient \
    && if [ ! -f libclntsh.so ]; then ln -s "$(ls -1 libclntsh.so.* | sort -V | tail -n 1)" libclntsh.so; fi \
    && if [ ! -f libnnz.so ]; then ln -s "$(ls -1 libnnz*.so* | sort -V | tail -n 1)" libnnz.so; fi

COPY --from=build /app /app

EXPOSE 5080

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
