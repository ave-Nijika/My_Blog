"use client";

/**
 * 后台时间展示：必须在客户端渲染。
 * 后台页面是 server component，服务器的时区通常是 UTC，
 * 在服务端 toLocaleString 会把时间渲染成 UTC 墙钟（与访客本地时间差 8 小时，
 * 即主人反馈的"管理员评论时间不同步"）。客户端渲染则天然按访客本地时区。
 */
export function AdminDateTime({ value }: { value: string | Date | null | undefined }) {
  if (!value) return <div>—</div>;
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return <div>—</div>;
  return <div>{d.toLocaleString()}</div>;
}
