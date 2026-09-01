/**
 * 后台文章管理专用 Git 工具（lib/content-git.ts）。
 *
 * 职责：
 *   - 检查当前工作目录是否处于 git 仓库内。
 *   - stage 一个或多个文件并生成提交，提交信息由调用方决定。
 *   - 暴露明确错误信息供 API 路由回传给前端。
 *
 * 设计要点：
 *   - 全部走 `execFile`（参数数组），不拼 shell 字符串，避免注入。
 *   - commit 时附带 `--author` 与环境变量覆盖，避免依赖全局 git config。
 *   - 提交信息里的 article id 由调用方传入；M2b 阶段我们用 "content: ..." 前缀
 *     与规格 6.6 "保存即 Git 提交" 对齐。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getContentRepoRoot } from "./content-paths";

const execFileAsync = promisify(execFile);

const COMMIT_AUTHOR_NAME = "blog-admin-bot";
const COMMIT_AUTHOR_EMAIL = "blog-admin-bot@users.noreply.localhost";

export class GitCommitError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_A_REPO" | "GIT_FAILED" | "NOTHING_TO_COMMIT"
  ) {
    super(message);
    this.name = "GitCommitError";
  }
}

export async function isGitRepository(): Promise<boolean> {
  try {
    await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: getContentRepoRoot(),
    });
    return true;
  } catch {
    return false;
  }
}

async function execGit(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", args, {
    cwd: getContentRepoRoot(),
    maxBuffer: 8 * 1024 * 1024,
  });
}

/**
 * stage 并提交给定文件路径（相对仓库根，使用 POSIX 风格分隔符）。
 * - 必须至少有一个文件发生变更；若 git 报告 "nothing to commit"，抛出 NOTHING_TO_COMMIT。
 * - 不是 git 仓库抛 NOT_A_REPO；其他失败抛 GIT_FAILED。
 */
export async function commitFiles(
  files: string[],
  message: string
): Promise<{ commitSha: string; message: string }> {
  if (files.length === 0) {
    throw new GitCommitError("没有可提交的文件", "NOTHING_TO_COMMIT");
  }
  if (!(await isGitRepository())) {
    throw new GitCommitError(
      "当前目录不是 git 仓库，无法保存文章。请先在内容目录（content/）初始化 git 仓库。",
      "NOT_A_REPO"
    );
  }

  // 逐个 add，单文件失败立刻抛出可读错误。
  for (const file of files) {
    try {
      await execGit(["add", "--", file]);
    } catch (error) {
      const stderr =
        (error as { stderr?: string }).stderr?.toString() ??
        (error as Error).message;
      throw new GitCommitError(
        `git add 失败（${file}）：${stderr.trim()}`,
        "GIT_FAILED"
      );
    }
  }

  // 用 --allow-empty 防止 "nothing to commit" 中断流程；如确实无变更，后续再判断。
  let commitResult: { stdout: string; stderr: string };
  try {
    commitResult = await execGit([
      "-c",
      `user.name=${COMMIT_AUTHOR_NAME}`,
      "-c",
      `user.email=${COMMIT_AUTHOR_EMAIL}`,
      "commit",
      "-m",
      message,
      "--author",
      `${COMMIT_AUTHOR_NAME} <${COMMIT_AUTHOR_EMAIL}>`,
    ]);
  } catch (error) {
    const stderr =
      (error as { stderr?: string }).stderr?.toString() ??
      (error as Error).message;
    if (/nothing to commit/i.test(stderr)) {
      throw new GitCommitError(
        "没有需要提交的内容（文件未发生变化）",
        "NOTHING_TO_COMMIT"
      );
    }
    throw new GitCommitError(
      `git commit 失败：${stderr.trim()}`,
      "GIT_FAILED"
    );
  }

  const shaResult = await execGit(["rev-parse", "HEAD"]);
  return {
    commitSha: shaResult.stdout.trim(),
    message: commitResult.stdout.trim(),
  };
}

/**
 * stage 删除（git rm）并提交。空数组视为无操作。
 */
export async function removeFiles(
  files: string[],
  message: string
): Promise<{ commitSha: string; message: string }> {
  if (files.length === 0) {
    throw new GitCommitError("没有可删除的文件", "NOTHING_TO_COMMIT");
  }
  if (!(await isGitRepository())) {
    throw new GitCommitError(
      "当前目录不是 git 仓库，无法删除文章。请先在内容目录（content/）初始化 git 仓库。",
      "NOT_A_REPO"
    );
  }

  for (const file of files) {
    try {
      // --ignore-unmatch 允许文件之前未在 git 中跟踪时仍然成功
      await execGit(["rm", "--ignore-unmatch", "--", file]);
    } catch (error) {
      const stderr =
        (error as { stderr?: string }).stderr?.toString() ??
        (error as Error).message;
      throw new GitCommitError(
        `git rm 失败（${file}）：${stderr.trim()}`,
        "GIT_FAILED"
      );
    }
  }

  let commitResult: { stdout: string; stderr: string };
  try {
    commitResult = await execGit([
      "-c",
      `user.name=${COMMIT_AUTHOR_NAME}`,
      "-c",
      `user.email=${COMMIT_AUTHOR_EMAIL}`,
      "commit",
      "-m",
      message,
      "--author",
      `${COMMIT_AUTHOR_NAME} <${COMMIT_AUTHOR_EMAIL}>`,
    ]);
  } catch (error) {
    const stderr =
      (error as { stderr?: string }).stderr?.toString() ??
      (error as Error).message;
    if (/nothing to commit/i.test(stderr)) {
      throw new GitCommitError(
        "没有需要提交的内容（文件未发生变化）",
        "NOTHING_TO_COMMIT"
      );
    }
    throw new GitCommitError(
      `git commit 失败：${stderr.trim()}`,
      "GIT_FAILED"
    );
  }

  const shaResult = await execGit(["rev-parse", "HEAD"]);
  return {
    commitSha: shaResult.stdout.trim(),
    message: commitResult.stdout.trim(),
  };
}
