# syntax=docker/dockerfile:1

FROM node:22-alpine AS builder

WORKDIR /app

RUN apk add --no-cache libc6-compat

COPY package.json pnpm-lock.yaml ./
RUN corepack enable pnpm && pnpm install --frozen-lockfile

COPY . .

# 审核报告 P1-6：NEXT_PUBLIC_* 变量在构建期内联进客户端包，
# 必须以 build-arg 方式传入（运行期环境变量无法改变它们）。
ARG NEXT_PUBLIC_CAPTCHA_SITE_KEY=""
ENV NEXT_PUBLIC_CAPTCHA_SITE_KEY=$NEXT_PUBLIC_CAPTCHA_SITE_KEY

# 审核报告 P0-5：生产构建基于 PostgreSQL schema 生成 Prisma Client，
# 运行期才能正确连接 postgres:// 数据库（本地开发仍用默认 sqlite schema）。
RUN pnpm prisma generate --schema prisma/pg/schema.prisma && pnpm build

FROM node:22-alpine AS runner

WORKDIR /app

# 审核报告 P0-6：git 是后台"保存即 Git 提交"的硬依赖；
# prisma CLI 用于容器内执行迁移（见 docs/deploy-aliyun.md）。
RUN apk add --no-cache libc6-compat git \
    && npm install -g --no-audit --no-fund prisma@6.19.3

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

ENV NODE_ENV=production

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# 审核报告 P0-5/P0-6：把迁移、运维脚本与它们引用的 lib 打进运行镜像，
# 使 docker compose exec app pnpm db:migrate:pg / db:sync / admin:create 可用。
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/lib ./lib
COPY docker/entrypoint.sh /app/docker/entrypoint.sh

RUN chmod +x /app/docker/entrypoint.sh \
    && mkdir -p /app/uploads /app/db \
    && chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# entrypoint 负责把 /app/content 初始化为 git 仓库（幂等），再启动应用
ENTRYPOINT ["/app/docker/entrypoint.sh"]
CMD ["node", "server.js"]
