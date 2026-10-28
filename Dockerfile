# Stage 1: build the React frontend into /app/dist
FROM node:24-slim AS build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
COPY shared/ ../shared/
RUN npm run build

# Stage 2: the Node server (no npm dependencies, only built-in modules such as node:sqlite)
FROM node:24-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8765
WORKDIR /app
COPY package.json ./
COPY server/ ./server/
COPY shared/ ./shared/
COPY --from=build /app/dist ./dist/
COPY images/bed.jpg ./images/bed.jpg
RUN mkdir -p db images/products && chown -R node:node /app
USER node
EXPOSE 8765
VOLUME ["/app/db", "/app/images"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8765/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# --no-browser: inside Linux there is no cmd.exe to open a browser tab
CMD ["node", "server/index.js", "--no-browser"]
