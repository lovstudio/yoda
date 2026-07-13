FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY services/relay/package.json services/relay/tsconfig.json services/relay/tsconfig.build.json ./services/relay/
RUN pnpm install --frozen-lockfile --filter @yoda/relay --ignore-scripts
COPY services/relay/src ./services/relay/src
RUN pnpm --filter @yoda/relay build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable
COPY services/relay/package.json services/relay/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod --ignore-scripts
COPY --from=build /app/services/relay/dist ./dist
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/index.js"]
