# 拾光笔记 · Learning Blog

个人学习博客系统，记录学习笔记、课程总结、项目复盘与技术心得。基于 Next.js 全栈开发，支持中英双语、亮暗主题、评论审核、ComfyUI 工作流分享等功能。

## 特性

- 📝 Markdown 内容管理，Git 仓库作为内容唯一来源，数据库为派生索引
- 🌐 中英双语 + 亮暗主题切换
- 💬 评论系统（提交冷却 / 限流 / 审核流程 / LLM 过滤 / 封禁）
- 🎨 碧蓝档案（Blue Archive）风格 UI
- 🖼️ ComfyUI 专区（工作流 JSON + 图片上传分享，缩略图自动生成）
- 🔐 管理员后台（文章 CRUD、评论审核、审计日志、账号设置）
- 🐳 Docker Compose + Nginx 生产部署

## 技术栈

- **框架**：Next.js 16（App Router）+ TypeScript（严格模式）
- **样式**：Tailwind CSS 4
- **数据库**：Prisma 6 + SQLite（本地开发）/ PostgreSQL（生产部署）
- **部署**：Docker Compose + Nginx

## 快速开始（本地开发）

```bash
# 安装依赖
pnpm install

# 配置环境变量
cp .env.example .env

# 初始化本地数据库（SQLite）
pnpm prisma migrate deploy

# 同步文章到数据库
pnpm db:sync

# 初始化站点资料（可选）
pnpm db:seed

# 启动开发服务器
pnpm dev
```

## 生产部署（PostgreSQL）

> ⚠️ `APP_URL` 必须等于实际访问源（协议 + 域名 + 端口），否则后台登录会静默 403。

```bash
# 1. 配置生产环境变量
cp .env.example .env.production
# 编辑 .env.production，填入 POSTGRES_PASSWORD、SESSION_SECRET 等

# 2. 构建应用镜像（构建期自动基于 PG schema 生成 Prisma Client）
docker compose -f docker-compose.prod.yml build app

# 3. 执行数据库迁移
docker compose -f docker-compose.prod.yml run --rm app \
  npx prisma migrate deploy --schema prisma/pg/schema.prisma

# 4. 同步内容到数据库
docker compose -f docker-compose.prod.yml run --rm app node scripts/sync-content.ts

# 5. 创建管理员账户
docker compose -f docker-compose.prod.yml run --rm \
  -e ADMIN_USERNAME=admin -e ADMIN_PASSWORD=your-password \
  app node scripts/admin-create.ts

# 6. 启动全部服务
docker compose -f docker-compose.prod.yml up -d
```

更详细的部署说明见 `docs/deploy-aliyun.md`。

## 管理员

```bash
ADMIN_USERNAME=admin ADMIN_PASSWORD=your-password pnpm admin:create
```

默认后台登录路径见 `.env` 中的 `ADMIN_LOGIN_PATH`（生产环境建议自定义）。

## 项目结构

```
app/              # Next.js 页面与 API 路由
components/       # 共享组件
content/posts/    # Markdown 文章（内容唯一来源）
lib/              # 核心逻辑（DB/内容同步/认证/CSRF/校验）
prisma/           # 数据库 Schema 与迁移
scripts/          # 运维脚本（同步/种子/管理员创建）
docker/           # Docker Compose 配置
nginx/            # Nginx 配置
tests/            # 测试
```

## 测试

```bash
pnpm test          # 单元测试 + HTTP 集成测试
pnpm test:watch    # 监听模式
```

## 许可证

个人学习项目，未指定许可证。仅供学习交流使用。
