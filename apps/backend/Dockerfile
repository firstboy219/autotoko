# syntax=docker/dockerfile:1
# Build artifacts are produced off-server (local/CI) per the deploy strategy,
# but this Dockerfile keeps the image reproducible. Multi-stage to stay lean.

FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /app

# --- deps ---
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/shared/package.json packages/shared/
COPY apps/backend/package.json apps/backend/
RUN pnpm install --frozen-lockfile --filter @autotoko/backend...

# --- build ---
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/backend apps/backend
RUN pnpm --filter @autotoko/shared build && pnpm --filter @autotoko/backend build

# --- runtime ---
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/apps/backend/dist ./dist
COPY --from=build /app/apps/backend/package.json ./
COPY --from=build /app/node_modules ./node_modules
EXPOSE 8080
CMD ["node", "dist/main.js"]
