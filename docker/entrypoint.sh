#!/bin/sh
# 容器启动前置（以 root 运行：Dockerfile 在 ENTRYPOINT 前不设 USER，见下）。
# 1) 权限根治（文章管理写操作 EACCES 修复）：content-repo / uploads-data 命名卷
#    首次创建时数据属主固定为 root:root，而应用以 nextjs:nodejs（uid 1001）运行，
#    Dockerfile 构建期的 chown 对卷内数据不生效。每次启动以 root 重新 chown（幂等）；
#    `|| true` + 2>/dev/null 兜底非 root 场景（如 compose 覆盖 user）不阻断启动。
# 2) 把 /app/content 初始化为 git 仓库（审核报告 P0-6）：后台"保存即 Git 提交"
#    （lib/content-git.ts）要求内容目录本身是一个 git 仓库；
#    生产容器里 /app 不是 git 仓库，只有挂载的 content 卷需要初始化一次。
# 3) 末尾 exec su-exec 降权为 nextjs:nodejs 运行主进程（CMD）。
set -e

chown -R nextjs:nodejs /app/content 2>/dev/null || true
chown -R nextjs:nodejs /app/uploads 2>/dev/null || true

CONTENT_DIR="/app/content"

if [ -d "$CONTENT_DIR" ] && [ ! -e "$CONTENT_DIR/.git" ]; then
  echo "[entrypoint] /app/content 不是 git 仓库，正在初始化..."
  cd "$CONTENT_DIR"
  git init -q -b main
  git config user.name "blog-admin-bot"
  git config user.email "blog-admin-bot@users.noreply.localhost"
  git add -A
  # 目录为空（全新卷）时没有可提交内容，允许失败继续
  git commit -q -m "chore: initialize content repository" || true
  echo "[entrypoint] content git 仓库初始化完成。"
  # 本段 git 命令以 root 执行，.git 内新对象属主为 root，再归正一次
  chown -R nextjs:nodejs "$CONTENT_DIR" 2>/dev/null || true
fi

# 降权运行主进程（应用不以 root 跑，保持原 USER nextjs 的安全语义）
exec su-exec nextjs:nodejs "$@"
