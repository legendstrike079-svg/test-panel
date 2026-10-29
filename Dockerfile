# ==========================================================================
#  Zenith Panel - container image
#  Build:  docker build -t zenith-panel .
#  Run:    docker run -d --name zenith -p 8080:8080 -p 25565-25575:25565-25575 \
#            -v $(pwd)/data:/app/data -v $(pwd)/servers:/app/servers \
#            -v $(pwd)/backups:/app/backups -v /var/run/docker.sock:/var/run/docker.sock \
#            -e DOCKER_BIND_ROOT="$(pwd)/servers" zenith-panel
#  The socket is for the trusted panel control plane only; it is never passed
#  into a tenant workload. Docker compose supplies the same wiring by default.
# ==========================================================================
# Docker's static CLI is copied into the panel image so, when the operator
# explicitly mounts the host Docker socket, the panel can create its managed
# workloads without starting a second daemon (Docker-in-Docker).
FROM docker:27-cli AS docker-cli

FROM node:20-bookworm-slim

COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/app/data \
    SERVER_DATA_DIR=/app/servers \
    BACKUP_DIR=/app/backups \
    JAVA_DIR=/app/data/java

# java 21 for Minecraft servers, zip/unzip for backups, tar/curl for installers
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      openjdk-17-jre-headless zip unzip tar curl ca-certificates procps \
 && rm -rf /var/lib/apt/lists/*

# optional: a modern JRE for 1.20.5+ servers (adds ~180MB, remove if unused)
ARG INSTALL_JAVA21=true
RUN if [ "$INSTALL_JAVA21" = "true" ]; then \
      apt-get update && apt-get install -y --no-install-recommends wget && \
      wget -qO /tmp/jre21.tar.gz "https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jre/hotspot/normal/eclipse" && \
      mkdir -p /opt/java21 && tar -xzf /tmp/jre21.tar.gz -C /opt/java21 --strip-components=1 && \
      rm /tmp/jre21.tar.gz && apt-get purge -y wget && rm -rf /var/lib/apt/lists/* ; \
    else echo "skipping java21"; fi

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .
RUN mkdir -p data data/tmp data/bin data/java servers backups logs \
 && node scripts/postinstall.js || true

VOLUME ["/app/data", "/app/servers", "/app/backups"]
EXPOSE 8080 25565-25575

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/version').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
