# زاد — single-image build: compiles server + client, serves both on PORT (default 3001)
FROM node:20-bookworm

WORKDIR /app

# install deps first (better layer caching) — workspace package manifests
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci

# build server (tsc) + client (vite)
COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

# the Express server (server/dist) also serves the built SPA (client/dist) — see server/src/app.ts
CMD ["node", "server/dist/index.js"]
