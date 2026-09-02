# syntax=docker/dockerfile:1

FROM node:22-alpine

WORKDIR /app

# git 是后台"保存即 Git 提交"的硬依赖
# prisma CLI 用于容器内执行迁移
# su-exec 用于 entrypoint 以 root 完成 chown 后降权运行主进程
RUN apk add --no-cache libc6-compat git su-exec \
    && npm install -g --no-audit --no-fund prisma@6.19.3

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

ENV NODE_ENV=production

# 预构建产物（本机构建，服务器 COPY 不编译）
COPY package.json ./
# 生产依赖安装（standalone 不含 node_modules，需在镜像内安装）
RUN npm config set registry https://registry.npmmirror.com \
    && npm install --omit=dev --no-audit --no-fund

# Prisma Client 必须在容器内生成（基于 PG schema），否则运行时
# "@prisma/client did not initialize yet"
COPY prisma ./prisma
RUN npx prisma generate --schema prisma/pg/schema.prisma

COPY .next/standalone ./
COPY .next/static ./.next/static
COPY public ./public
COPY scripts ./scripts
COPY lib ./lib
COPY docker/entrypoint.sh /app/docker/entrypoint.sh

RUN chmod +x /app/docker/entrypoint.sh \
    && mkdir -p /app/uploads /app/db

# 注意：此处不设 USER nextjs —— entrypoint 需以 root 执行 chown
# 修正命名卷内数据属主，再经 su-exec 降权为 nextjs 运行主进程

EXPOSE 3000
ENV PORT=3000 HOSTNAME="0.0.0.0"

ENTRYPOINT ["/app/docker/entrypoint.sh"]
CMD ["node", "server.js"]