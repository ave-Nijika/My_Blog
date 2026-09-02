#!/bin/sh
# 容器启动前置（以 root 运行：Dockerfile 在 ENTRYPOINT 前不设 USER，见下）。
# 1) 权限根治（文章管理写操作 EACCES 修复）：content-repo / uploads-data 命名卷
#    首次创建时数据属主固定为 root:root，而应用以 nextjs:nodejs（uid 1001）运行，
#    Dockerfile 构建期的 chown 对卷内数据不生效。每次启动以 root 重新 chown（幂等）；
#    `|| true` + 2>/dev/null 兜底非 root 场景（如 compose 覆盖 user）不阻断启动。
# 2) 把 /app 初始化为 git 仓库（lib/content-paths.ts 的 getContentRepoRoot() =
#    postsDir/../.. = /app，应用在 /app 目录下执行 git rev-parse/commit）：
#    后台"保存即 Git 提交"（lib/content-git.ts）要求 getContentRepoRoot() 指向
#    的目录本身是一个 git 仓库；生产容器里只有 /app 是应用 cwd，因此在此初始化，
#    仅 track content/ 内容目录（其余为应用代码，不入库）。
# 3) 旧版残留处理：此前 entrypoint 在 /app/content 初始化过独立 git 仓库，
#    仓库根迁移到 /app 后，content/.git 是嵌套仓库，须先移除避免被当作
#    gitlink（embedded repository）提交。
# 4) /app 整体归主 nextjs：git 2.35+ 的 dubious ownership 检查要求仓库根
#    （/app）属主与运行用户一致，否则 git 拒绝执行（fatal: dubious ownership）。
# 5) 末尾 exec su-exec 降权为 nextjs:nodejs 运行主进程（CMD）。
set -e

chown -R nextjs:nodejs /app/content 2>/dev/null || true
chown -R nextjs:nodejs /app/uploads 2>/dev/null || true
chown -R nextjs:nodejs /app 2>/dev/null || true

CONTENT_DIR="/app/content"
REPO_DIR="/app"

if [ -d "$REPO_DIR" ] && [ ! -e "$REPO_DIR/.git" ]; then
  # 清理旧版 content 独立仓库残留（嵌套仓库会导致 git add content/ 变成 gitlink）
  if [ -e "$CONTENT_DIR/.git" ]; then
    echo "[entrypoint] 移除 content 目录旧版独立 .git（仓库根已迁移到 /app）"
    rm -rf "$CONTENT_DIR/.git"
  fi
  echo "[entrypoint] /app 不是 git 仓库，正在初始化..."
  cd "$REPO_DIR"
  git init -q -b main
  git config user.name "blog-admin-bot"
  git config user.email "blog-admin-bot@users.noreply.localhost"
  git add content/
  # 目录为空（全新卷）时没有可提交内容，允许失败继续
  git commit -q -m "chore: initialize content repository" || true
  echo "[entrypoint] content git 仓库初始化完成。"
  # 本段 git 命令以 root 执行，.git 内新对象属主为 root，再归正一次
  chown -R nextjs:nodejs "$REPO_DIR/.git" 2>/dev/null || true
fi

# 降权运行主进程（应用不以 root 跑，保持原 USER nextjs 的安全语义）
exec su-exec nextjs:nodejs "$@"
