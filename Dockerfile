FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY . .
RUN mkdir -p /app/reports && chown -R node:node /app/reports
ENV NODE_ENV=production HOSTED=1 HOST=0.0.0.0 PORT=8740
USER node
EXPOSE 8740
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8740/healthz || exit 1
CMD ["node", "server.js"]
