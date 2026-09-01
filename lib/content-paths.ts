/**
 * 内容目录解析（统一内容源路径的单一出口）。
 *
 * - 默认：process.cwd()/content/posts（与历史行为一致）。
 * - 测试/特殊部署：可通过 CONTENT_POSTS_DIR 环境变量覆盖（绝对或相对 cwd 路径），
 *   使集成测试可以把内容指向独立临时 git 仓库，不污染真实仓库。
 * - git 操作（提交、rev-parse）都以"内容仓库根"为工作目录：
 *   生产容器里只有 /app/content 是 git 仓库（见 docker/entrypoint.sh），
 *   本地开发时 content/../.. 即项目根，同样是 git 仓库，两种场景都成立。
 */
import path from "node:path";

export function getPostsDir(): string {
  const override = process.env.CONTENT_POSTS_DIR?.trim();
  if (override) return path.resolve(process.cwd(), override);
  return path.join(process.cwd(), "content", "posts");
}

export function getContentRepoRoot(): string {
  return path.resolve(getPostsDir(), "..", "..");
}
