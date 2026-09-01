import { syncContent } from "../lib/content-sync.ts";

async function main() {
  const startedAt = Date.now();
  const result = await syncContent();
  const elapsedMs = Date.now() - startedAt;

  console.log(
    `内容同步完成（耗时 ${elapsedMs}ms）：` +
      `新增 ${result.created} 篇，更新 ${result.updated} 篇，归档 ${result.archived} 篇；` +
      `同步标签 ${result.tags} 个，分类 ${result.categories} 个。`
  );
  console.log(`同步提交：${result.commitSha || "（无 git 仓库或未提交）"}`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[db:sync] 内容同步失败：", error);
    process.exit(1);
  });