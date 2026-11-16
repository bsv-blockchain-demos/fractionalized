# Build context: repo root (server imports shared/ and resolves @shared/* via the root tsconfig).
FROM node:22.23.4-alpine
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY client/package.json client/
COPY server/package.json server/
COPY shared/package.json shared/
RUN npm ci --omit=dev -w @fraction/server -w @fraction/shared
COPY shared/ shared/
COPY server/ server/
COPY scripts/db-migrate.ts scripts/
USER node
EXPOSE 3001
# db-migrate is idempotent; the server fails fast at boot if its indexes are missing.
CMD ["sh", "-c", "node_modules/.bin/tsx scripts/db-migrate.ts && exec node_modules/.bin/tsx server/index.ts"]
