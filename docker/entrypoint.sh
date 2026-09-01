#!/bin/sh
# 容器启动前置：把 /app/content 初始化为 git 仓库（审核报告 P0-6）。
# 后台"保存即 Git 提交"（lib/content-git.ts）要求内容目录本身是一个 git 仓库；
# 生产容器里 /app 不是 git 仓库，只有挂载的 content 卷需要初始化一次。
set -e

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
fi

exec "$@"
