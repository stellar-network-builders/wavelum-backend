FROM node:22-trixie-slim AS deps

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund \
  && mkdir -p /app/logs

FROM gcr.io/distroless/nodejs22-debian13:nonroot AS runtime

ENV NODE_ENV=production
ENV PORT=3001

WORKDIR /app

COPY --from=deps --chown=65532:65532 /app/node_modules ./node_modules
COPY --from=deps --chown=65532:65532 /app/logs ./logs
COPY --chown=65532:65532 package.json monitor.js walLag.js ./

USER 65532

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "const http=require('http');const req=http.get('http://127.0.0.1:3001/health',res=>process.exit(res.statusCode===200?0:1));req.on('error',()=>process.exit(1));"]

CMD ["monitor.js"]
