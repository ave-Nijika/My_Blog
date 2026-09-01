// Validation schemas for admin API inputs using Zod
import { z } from "zod";

// Login schema: username and password non-empty strings
export const loginSchema = z.object({
  username: z.string().min(1, { message: "用户名不能为空" }),
  password: z.string().min(1, { message: "密码不能为空" }),
});

// Helper regex for slug: lowercase alphanumeric and hyphens, no leading/trailing hyphen
const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const createPostSchema = z.object({
  slug: z.string().min(1).max(100).regex(slugRegex, { message: "slug 只能包含小写字母、数字和中划线" }),
  title: z.string().min(1, { message: "标题不能为空" }).max(200, { message: "标题长度不能超过 200" }),
  summary: z.string().max(500).optional(),
  status: z.enum(["draft", "public", "private"], { errorMap: () => ({ message: "status 必须是 draft/public/private" }) }),
  category: z.string().max(64).optional(),
  tags: z.array(z.string().max(64)).optional(),
  cover: z.string().max(500).optional(),
  pinned: z.boolean().optional(),
  publishedAt: z.string().datetime().optional().nullable(),
  body: z.string().max(200000, { message: "正文长度不能超过 200000" }),
});

// Update can reuse create schema but all fields optional except body when full update
export const updatePostSchema = createPostSchema.partial();

// Comment input from public API. We only enforce "is string" here — length
// checks happen against env-driven limits in lib/comments.ts so the same
// source of truth is used for validation and error messages.
export const commentBodySchema = z.object({
  bodyText: z.string({ message: "评论内容不能为空" }),
  captchaToken: z.string().optional(),
});
