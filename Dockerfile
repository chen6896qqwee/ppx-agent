# ---- 构建阶段: 前端 Next.js 生产产物 ----
FROM node:22-slim AS webbuilder
WORKDIR /app
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---- 运行阶段: 内核 + 前端 ----
FROM node:22-slim
WORKDIR /app

# 内核 (零依赖纯 Node)
COPY package.json ./
COPY src/ ./src/
COPY config/ ./config/
COPY docs/ ./docs/
COPY README.md LICENSE ./
COPY scripts/start-web.js ./scripts/start-web.js

# 前端 build 产物 + 运行时依赖
COPY --from=webbuilder /app/.next ./web/.next
COPY --from=webbuilder /app/node_modules ./web/node_modules
COPY --from=webbuilder /app/package.json ./web/package.json
COPY --from=webbuilder /app/next.config.ts ./web/next.config.ts
COPY --from=webbuilder /app/public ./web/public

# 数据目录外置到 ~/.ppx (容器重建不丢)
ENV PPX_DATA_DIR=/root/.ppx
ENV NODE_ENV=production

EXPOSE 8899 3000
CMD ["node", "scripts/start-web.js"]
