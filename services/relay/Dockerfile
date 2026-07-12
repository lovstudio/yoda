FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY services/relay/package.json services/relay/tsconfig.json services/relay/tsconfig.build.json ./services/relay/
RUN pnpm install --frozen-lockfile --filter @yoda/relay...
COPY services/relay/src ./services/relay/src
RUN pnpm --filter @yoda/relay build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY services/relay/package.json ./services/relay/
RUN pnpm install --frozen-lockfile --prod --filter @yoda/relay...
COPY --from=build /app/services/relay/dist ./services/relay/dist
USER node
EXPOSE 8787
CMD ["node", "services/relay/dist/index.js"]
