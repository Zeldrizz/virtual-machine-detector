FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=9331
ENV LOG_PATH=/app/data/scans.log
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --chown=node:node package.json package.json
COPY --chown=node:node app ./app
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 9331
CMD ["node", "app/server.js"]
