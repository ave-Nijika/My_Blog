import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getIdentityHash,
  getBucketStart,
  generateVisitorToken,
  getTokenHash,
  getAutoBanThreshold,
  getBanDurationMs,
  applyWarning,
  checkBan,
  createAdminBan,
  revokeBan,
  listActiveBans,
  getVisitorInfo,
  recordView,
  getViewCount,
} from "../../lib/visitor";
import { invalidateSiteSettingsCache } from "../../lib/site-settings";

const mockDb = vi.hoisted(() => ({
  visitorRisk: {
    upsert: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(async () => []),
    count: vi.fn(async () => 0),
  },
  visitorBan: {
    findMany: vi.fn(async () => []),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  visitorWarningEvent: { create: vi.fn(async () => ({ id: "evt" })) },
  adminSession: { findFirst: vi.fn() },
  siteSettings: { findFirst: vi.fn(async () => null) },
  articleViewDedup: {
    findFirst: vi.fn(),
    create: vi.fn(async () => ({ id: "dedup" })),
    count: vi.fn(async () => 0),
  },
  article: { update: vi.fn(async () => ({ id: "a" })) },
}));

vi.mock("../../lib/db", () => ({ db: mockDb }));

describe("lib/visitor.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateSiteSettingsCache();
    // 阈值测试用 mockResolvedValue 设置的实现会跨用例泄漏，显式归位
    mockDb.siteSettings.findFirst.mockResolvedValue(null);
    delete process.env.COMMENT_AUTO_BAN_THRESHOLD;
    delete process.env.COMMENT_BAN_DURATION_SECONDS;
  });

  afterEach(() => {
    invalidateSiteSettingsCache();
    delete process.env.COMMENT_AUTO_BAN_THRESHOLD;
    delete process.env.COMMENT_BAN_DURATION_SECONDS;
  });

  describe("身份哈希与时间桶", () => {
    it("getIdentityHash：同 IP 稳定、不同 IP 不同、64 位十六进制", () => {
      expect(getIdentityHash("1.2.3.4")).toBe(getIdentityHash("1.2.3.4"));
      expect(getIdentityHash("1.2.3.4")).not.toBe(getIdentityHash("1.2.3.5"));
      expect(getIdentityHash("127.0.0.1")).toMatch(/^[a-f0-9]{64}$/);
    });

    it("getBucketStart：按 UTC 天对齐（24h 去重桶）", () => {
      const a = getBucketStart(new Date("2024-01-15T00:00:01Z"));
      const b = getBucketStart(new Date("2024-01-15T23:59:59Z"));
      const c = getBucketStart(new Date("2024-01-16T00:00:01Z"));
      expect(a.getTime()).toBe(b.getTime());
      expect(a.toISOString()).toBe("2024-01-15T00:00:00.000Z");
      expect(c.getTime()).toBe(a.getTime() + 24 * 60 * 60 * 1000);
    });
  });

  describe("访客 token", () => {
    it("generateVisitorToken：32 字节随机（64 位 hex），互不相同", () => {
      const t1 = generateVisitorToken();
      const t2 = generateVisitorToken();
      expect(t1).toMatch(/^[a-f0-9]{64}$/);
      expect(t1).not.toBe(t2);
    });

    it("getTokenHash：确定性、不可逆映射到 64 位十六进制", () => {
      expect(getTokenHash("t")).toBe(getTokenHash("t"));
      expect(getTokenHash("t1")).not.toBe(getTokenHash("t2"));
      expect(getTokenHash("t")).toMatch(/^[a-f0-9]{64}$/);
      expect(getTokenHash("t")).not.toContain("t");
    });
  });

  describe("警告/封禁阈值配置", () => {
    it("无 SiteSettings 行时默认阈值 3（env 不再参与，DB 优先）", async () => {
      mockDb.siteSettings.findFirst.mockResolvedValue(null);
      expect(await getAutoBanThreshold()).toBe(3);
    });

    it("SiteSettings 行存在时使用 DB 中的 autoBanWarningThreshold", async () => {
      mockDb.siteSettings.findFirst.mockResolvedValue({
        autoBanWarningThreshold: 5,
      });
      expect(await getAutoBanThreshold()).toBe(5);
    });

    it("SiteSettings 行存在时使用 DB 中的 autoBanWarningThreshold（另一个值）", async () => {
      // 独立用例：beforeEach 已失效站点设置缓存，避免 5s TTL 串扰
      mockDb.siteSettings.findFirst.mockResolvedValue({
        autoBanWarningThreshold: 1,
      });
      expect(await getAutoBanThreshold()).toBe(1);
    });

    it("默认封禁 24h，env 以秒为单位可覆盖", () => {
      expect(getBanDurationMs()).toBe(24 * 60 * 60 * 1000);
      process.env.COMMENT_BAN_DURATION_SECONDS = "3600";
      expect(getBanDurationMs()).toBe(3_600_000);
      process.env.COMMENT_BAN_DURATION_SECONDS = "-1";
      expect(getBanDurationMs()).toBe(24 * 60 * 60 * 1000);
    });
  });

  describe("applyWarning（警告增量与自动封禁）", () => {
    it("delta 累加到 warningCount 并记录事件；未达阈值不封禁", async () => {
      mockDb.visitorRisk.upsert.mockResolvedValue({ warningCount: 2 });
      mockDb.visitorBan.findMany.mockResolvedValue([]);

      const r = await applyWarning({
        ipHmac: "ip-1",
        visitorTokenHash: "tok-1",
        delta: 1,
        source: "regex",
        reason: "regex reject",
      });

      expect(r).toEqual({ warningCount: 2, banned: false });
      expect(mockDb.visitorRisk.upsert).toHaveBeenCalledTimes(1);
      const upsertArg = mockDb.visitorRisk.upsert.mock.calls[0][0];
      expect(upsertArg.where.ipHmac_visitorTokenHash).toEqual({
        ipHmac: "ip-1",
        visitorTokenHash: "tok-1",
      });
      expect(upsertArg.create.warningCount).toBe(1);
      expect(upsertArg.update.warningCount).toEqual({ increment: 1 });
      expect(mockDb.visitorWarningEvent.create).toHaveBeenCalledTimes(1);
    });

    it("delta<=0 只记录事件、不动 warningCount", async () => {
      mockDb.visitorRisk.findUnique.mockResolvedValue({ warningCount: 4 });
      const r = await applyWarning({
        ipHmac: "ip-1",
        visitorTokenHash: "tok-1",
        delta: 0,
        source: "system",
      });
      expect(r).toEqual({ warningCount: 4, banned: false });
      expect(mockDb.visitorRisk.upsert).not.toHaveBeenCalled();
      expect(mockDb.visitorWarningEvent.create).toHaveBeenCalledTimes(1);
      expect(
        mockDb.visitorWarningEvent.create.mock.calls[0][0].data.delta
      ).toBe(0);
    });

    it("小数 delta 向下取整，负数视为 0", async () => {
      mockDb.visitorRisk.findUnique.mockResolvedValue({ warningCount: 1 });
      await applyWarning({
        ipHmac: "ip",
        visitorTokenHash: "t",
        delta: -3,
        source: "system",
      });
      expect(mockDb.visitorRisk.upsert).not.toHaveBeenCalled();
    });

    it("累计达到阈值自动创建封禁（matchType=ip，createdBy=system）", async () => {
      mockDb.visitorRisk.upsert.mockResolvedValue({ warningCount: 3 });
      mockDb.visitorBan.findMany.mockResolvedValue([]);
      mockDb.visitorBan.create.mockResolvedValue({
        id: "ban-1",
        matchType: "ip",
        ipHmac: "ip-1",
        visitorTokenHash: null,
        expiresAt: new Date(Date.now() + 86400000),
        permanent: false,
        reason: "x",
        createdAt: new Date(),
        createdBy: "system",
        revokedAt: null,
        revokedBy: null,
      });

      const r = await applyWarning({
        ipHmac: "ip-1",
        visitorTokenHash: "tok-1",
        delta: 3,
        source: "regex",
      });

      expect(r.banned).toBe(true);
      expect(r.banId).toBe("ban-1");
      const banData = mockDb.visitorBan.create.mock.calls[0][0].data;
      expect(banData.matchType).toBe("ip");
      expect(banData.ipHmac).toBe("ip-1");
      expect(banData.createdBy).toBe("system");
      expect(banData.permanent).toBe(false);
    });

    it("已存在有效封禁时不重复叠加", async () => {
      mockDb.visitorRisk.upsert.mockResolvedValue({ warningCount: 9 });
      mockDb.visitorBan.findMany.mockResolvedValue([
        {
          id: "ban-old",
          matchType: "ip",
          ipHmac: "ip-1",
          visitorTokenHash: null,
          expiresAt: new Date(Date.now() + 1000),
          permanent: false,
          reason: "",
          createdAt: new Date(),
          createdBy: "system",
          revokedAt: null,
          revokedBy: null,
        },
      ]);
      const r = await applyWarning({
        ipHmac: "ip-1",
        visitorTokenHash: "tok-1",
        delta: 1,
        source: "regex",
      });
      expect(r).toEqual({ warningCount: 9, banned: false });
      expect(mockDb.visitorBan.create).not.toHaveBeenCalled();
    });
  });

  describe("checkBan（封禁命中规则）", () => {
    const base = {
      id: "ban",
      ipHmac: "ip-1",
      visitorTokenHash: null,
      reason: "r",
      createdAt: new Date(),
      createdBy: "admin",
      revokedAt: null,
      revokedBy: null,
    };

    it("未命中返回 null", async () => {
      mockDb.visitorBan.findMany.mockResolvedValue([]);
      expect(await checkBan("ip-x", "tok-x")).toBeNull();
    });

    it("命中：未过期/永久/无到期时间", async () => {
      mockDb.visitorBan.findMany.mockResolvedValue([
        {
          ...base,
          matchType: "ip",
          expiresAt: new Date(Date.now() + 60_000),
          permanent: false,
        },
      ]);
      expect((await checkBan("ip-1", "tok"))?.id).toBe("ban");

      mockDb.visitorBan.findMany.mockResolvedValue([
        { ...base, matchType: "ip", expiresAt: null, permanent: true },
      ]);
      expect((await checkBan("ip-1", "tok"))?.permanent).toBe(true);
    });

    it("过期封禁不命中", async () => {
      mockDb.visitorBan.findMany.mockResolvedValue([
        {
          ...base,
          matchType: "ip",
          expiresAt: new Date(Date.now() - 1000),
          permanent: false,
        },
      ]);
      expect(await checkBan("ip-1", "tok")).toBeNull();
    });

    it("查询只取未撤销记录（撤销封禁由数据库层过滤）", async () => {
      mockDb.visitorBan.findMany.mockResolvedValue([]);
      await checkBan("ip-1", "tok");
      expect(mockDb.visitorBan.findMany.mock.calls[0][0].where.revokedAt).toBe(
        null
      );
    });
  });

  describe("createAdminBan / revokeBan / listActiveBans", () => {
    it("手动封禁：permanent 时 expiresAt=null；否则使用默认时长", async () => {
      mockDb.visitorBan.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "ban-2",
        createdAt: new Date(),
        revokedAt: null,
        revokedBy: null,
        ...data,
      }));
      const perm = await createAdminBan({
        ipHmac: "ip",
        visitorTokenHash: "tok",
        matchType: "visitor",
        reason: "滥用",
        permanent: true,
        adminId: "admin-1",
      });
      expect(perm.permanent).toBe(true);
      expect(perm.expiresAt).toBeNull();
      expect(perm.matchType).toBe("visitor");
      expect(perm.ipHmac).toBeNull();
      expect(perm.visitorTokenHash).toBe("tok");

      const temp = await createAdminBan({
        ipHmac: "ip",
        visitorTokenHash: "tok",
        matchType: "ip",
        reason: "",
        permanent: false,
        adminId: "admin-1",
      });
      expect(temp.permanent).toBe(false);
      const ms = (temp.expiresAt as Date).getTime() - Date.now();
      expect(ms).toBeGreaterThan(23 * 60 * 60 * 1000);
      expect(ms).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    });

    it("revokeBan：写入 revokedAt/revokedBy；记录不存在抛错", async () => {
      mockDb.visitorBan.findUnique.mockResolvedValue({ id: "ban-3" });
      mockDb.visitorBan.update.mockResolvedValue({
        id: "ban-3",
        matchType: "ip",
        ipHmac: "ip",
        visitorTokenHash: null,
        expiresAt: null,
        permanent: true,
        reason: "",
        createdAt: new Date(),
        createdBy: "a",
        revokedAt: new Date(),
        revokedBy: "admin-1",
      });
      const r = await revokeBan("ban-3", "admin-1");
      expect(r.revokedBy).toBe("admin-1");
      expect(r.revokedAt).toBeInstanceOf(Date);

      mockDb.visitorBan.findUnique.mockResolvedValue(null);
      await expect(revokeBan("nope", "admin-1")).rejects.toThrow();
    });

    it("listActiveBans 过滤过期记录", async () => {
      mockDb.visitorBan.findMany.mockResolvedValue([
        {
          id: "live",
          matchType: "ip",
          ipHmac: "ip",
          visitorTokenHash: null,
          expiresAt: new Date(Date.now() + 1000),
          permanent: false,
          reason: "",
          createdAt: new Date(),
          createdBy: "a",
          revokedAt: null,
          revokedBy: null,
        },
        {
          id: "expired",
          matchType: "ip",
          ipHmac: "ip2",
          visitorTokenHash: null,
          expiresAt: new Date(Date.now() - 1000),
          permanent: false,
          reason: "",
          createdAt: new Date(),
          createdBy: "a",
          revokedAt: null,
          revokedBy: null,
        },
      ]);
      const bans = await listActiveBans();
      expect(bans.map((b) => b.id)).toEqual(["live"]);
    });
  });

  describe("getVisitorInfo（请求解析）", () => {
    it("IP 提取：未配置可信代理时不采信 XFF（防伪造），用 x-real-ip 或 0.0.0.0 兜底", async () => {
      mockDb.adminSession.findFirst.mockResolvedValue(null);
      // 未配置 TRUSTED_PROXY_CIDRS 时，XFF 不可信（修复 P1-1 后的安全行为）
      const r1 = new Request("http://localhost/api", {
        headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" },
      });
      const i1 = await getVisitorInfo(r1);
      expect(i1.identityHash).toBe(getIdentityHash("0.0.0.0"));

      const r2 = new Request("http://localhost/api", {
        headers: { "x-real-ip": "8.8.8.8" },
      });
      expect((await getVisitorInfo(r2)).identityHash).toBe(
        getIdentityHash("8.8.8.8")
      );

      const r3 = new Request("http://localhost/api");
      expect((await getVisitorInfo(r3)).identityHash).toBe(
        getIdentityHash("0.0.0.0")
      );
    });

    it("IP 提取：配置可信代理后 XFF 从右往左取第一个不可信地址", async () => {
      const prev = process.env.TRUSTED_PROXY_CIDRS;
      process.env.TRUSTED_PROXY_CIDRS = "10.0.0.0/8";
      mockDb.adminSession.findFirst.mockResolvedValue(null);
      try {
        // XFF: "9.9.9.9, 10.0.0.1"；10.0.0.1 在可信网段内，从右往左取 9.9.9.9
        const r1 = new Request("http://localhost/api", {
          headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" },
        });
        const i1 = await getVisitorInfo(r1);
        expect(i1.identityHash).toBe(getIdentityHash("9.9.9.9"));
      } finally {
        if (prev === undefined) delete process.env.TRUSTED_PROXY_CIDRS;
        else process.env.TRUSTED_PROXY_CIDRS = prev;
      }
    });

    it("从 cookie 提取 visitor_token 并哈希；缺失时哈希空串", async () => {
      mockDb.adminSession.findFirst.mockResolvedValue(null);
      const withCookie = new Request("http://localhost/api", {
        headers: { cookie: "a=1; visitor_token=abc123; b=2" },
      });
      expect((await getVisitorInfo(withCookie)).tokenHash).toBe(
        getTokenHash("abc123")
      );

      const noCookie = new Request("http://localhost/api");
      expect((await getVisitorInfo(noCookie)).tokenHash).toBe(getTokenHash(""));
    });

    it("isAdmin：token 对应有效管理员会话时为 true", async () => {
      mockDb.adminSession.findFirst.mockResolvedValue({ id: "s1" });
      const req = new Request("http://localhost/api", {
        headers: { cookie: "visitor_token=some-token" },
      });
      const info = await getVisitorInfo(req);
      expect(info.isAdmin).toBe(true);
      expect(
        mockDb.adminSession.findFirst.mock.calls[0][0].where.tokenHash
      ).toBe(getTokenHash("some-token"));

      mockDb.adminSession.findFirst.mockResolvedValue(null);
      expect((await getVisitorInfo(req)).isAdmin).toBe(false);
    });
  });

  describe("recordView / getViewCount（阅读量 24h 去重）", () => {
    it("同桶内重复浏览只计数一次", async () => {
      mockDb.articleViewDedup.findFirst.mockResolvedValue(null);
      await recordView("article-1", "identity-1");
      expect(mockDb.articleViewDedup.create).toHaveBeenCalledTimes(1);
      expect(mockDb.article.update).toHaveBeenCalledTimes(1);
      expect(mockDb.article.update.mock.calls[0][0]).toEqual({
        where: { id: "article-1" },
        data: { viewCount: { increment: 1 } },
      });
      const createArg = mockDb.articleViewDedup.create.mock.calls[0][0];
      expect(createArg.data.articleId).toBe("article-1");
      expect(createArg.data.identityHash).toBe("identity-1");
      expect(createArg.data.bucketStart).toBeInstanceOf(Date);

      vi.clearAllMocks();
      mockDb.articleViewDedup.findFirst.mockResolvedValue({ id: "dedup-1" });
      await recordView("article-1", "identity-1");
      expect(mockDb.articleViewDedup.create).not.toHaveBeenCalled();
      expect(mockDb.article.update).not.toHaveBeenCalled();
    });

    it("getViewCount 返回去重表计数", async () => {
      mockDb.articleViewDedup.count.mockResolvedValue(42);
      expect(await getViewCount("article-1")).toBe(42);
      expect(mockDb.articleViewDedup.count).toHaveBeenCalledWith({
        where: { articleId: "article-1" },
      });
    });
  });
});
