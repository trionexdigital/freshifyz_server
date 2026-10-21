FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=127.0.0.1 PORT=4000
COPY --from=build --chown=node:node /app/package*.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
USER node
HEALTHCHECK --interval=30s --timeout=12s --start-period=15s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health/ready',{signal:AbortSignal.timeout(10000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/start.js"]
