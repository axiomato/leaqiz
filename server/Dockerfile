# leaqizz-Server. Gebaut aus dem Repo-Wurzelordner, weil der Server public/ ausliefert
# und die Spiellogik aus public/js/engine nutzt:
#   docker build -f server/Dockerfile -t leaqizz .

FROM node:24-alpine AS deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/server/node_modules server/node_modules
COPY server/package.json server/
COPY server/src server/src
COPY server/drizzle server/drizzle
COPY public public
# Versionsnummer an CSS/JS hängen, damit Browser nach jedem Update die neuen Dateien laden
ARG VERSION=dev
RUN find public -name '*.html' -exec sed -i "s/?v=dev/?v=${VERSION}/g" {} + && rm -rf public/__snap
USER node
WORKDIR /app/server
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/health > /dev/null || exit 1
CMD ["node", "src/index.js"]
