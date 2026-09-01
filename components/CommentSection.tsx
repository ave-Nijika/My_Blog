"use client";

/**
 * 文章底部评论区域：列表 + 提交表单（客户端组件）。
 *
 * - 列表直接由父 server component 通过 props 注入 approved 评论，避免额外的
 *   客户端请求（且 RSC 渲染天然快）。
 * - 提交表单：POST /api/posts/[slug]/comments，成功显示统一提示，失败显示通用提示。
 *   不向用户暴露"为什么失败"，仅做轻量输入校验（防止明显超长导致请求体过大）。
 * - 输入受 COMMENT_MAX_LENGTH 上限约束，避免本地提交被服务端 reject。
 * - Turnstile（修复审核报告 P1-6）：NEXT_PUBLIC_CAPTCHA_SITE_KEY 存在时渲染
 *   Cloudflare Turnstile 挂件并把 token 随评论提交；未配置时完全不加载脚本，
 *   行为与此前一致（服务端 CAPTCHA_ENABLED=false 时 Mock 放行）。
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/i18n/context";

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string | undefined;
  reset: (widgetId?: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

type CommentItem = {
  id: string;
  bodyText: string;
  createdAt: string;
};

type Props = {
  slug: string;
  initialComments: CommentItem[];
  maxLength: number;
  captchaSiteKey?: string;
};

export function CommentSection({
  slug,
  initialComments,
  maxLength,
  captchaSiteKey,
}: Props) {
  const router = useRouter();
  const { t, locale } = useLocale();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [captchaToken, setCaptchaToken] = useState("");
  const widgetRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!captchaSiteKey) return;
    const el = widgetRef.current;
    if (!el) return;

    const renderWidget = () => {
      if (!window.turnstile || !el || widgetIdRef.current !== null) return;
      widgetIdRef.current =
        window.turnstile.render(el, {
          sitekey: captchaSiteKey,
          callback: (token: string) => setCaptchaToken(token),
          "expired-callback": () => setCaptchaToken(""),
        }) ?? null;
    };

    if (window.turnstile) {
      renderWidget();
    } else {
      const existing = document.querySelector<HTMLScriptElement>(
        "script[data-turnstile='1']"
      );
      if (!existing) {
        const script = document.createElement("script");
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.defer = true;
        script.dataset.turnstile = "1";
        script.onload = renderWidget;
        document.head.appendChild(script);
      } else {
        existing.addEventListener("load", renderWidget);
      }
    }

    return () => {
      if (widgetIdRef.current !== null && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          /* ignore */
        }
        widgetIdRef.current = null;
      }
    };
  }, [captchaSiteKey]);

  function resetCaptcha() {
    setCaptchaToken("");
    if (widgetIdRef.current !== null && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const trimmed = text.trim();
    if (trimmed.length < 2) {
      setError(t("post").tooShort);
      return;
    }
    if (trimmed.length > maxLength) {
      setError(t("post").tooLong.replace("{{max}}", String(maxLength)));
      return;
    }

    startTransition(async () => {
      try {
        const res = await fetch(`/api/posts/${encodeURIComponent(slug)}/comments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bodyText: trimmed,
            ...(captchaToken ? { captchaToken } : {}),
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          message?: string;
          error?: string;
        };
        if (!res.ok || !data.ok) {
          setError(data.error || t("post").submitFailed);
          resetCaptcha();
          return;
        }
        setText("");
        setSuccess(data.message || t("post").submitSuccess);
        resetCaptcha();
        router.refresh();
      } catch {
        setError(t("common").networkError);
        resetCaptcha();
      }
    });
  }

  return (
    <section className="mt-12">
      <div className="mb-6 text-center">
        <h2 className="mb-2 text-xl font-bold text-sky-900 dark:text-slate-100">
          {t("post").commentsCount.replace("{{count}}", String(initialComments.length))}
        </h2>
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-sky-100/50 dark:bg-sky-900/30 rounded-full border border-sky-200/50 dark:border-sky-800/50">
          <div className="w-2 h-2 bg-gradient-to-r from-sky-400 to-cyan-300 rounded-full animate-pulse" />
          <span className="text-sm font-medium text-sky-700 dark:text-sky-300">
            {initialComments.length} 条评论
          </span>
        </div>
      </div>

      {initialComments.length === 0 ? (
        <div className="ba-card p-8 text-center">
          <div className="mb-4 w-16 h-16 bg-gradient-to-br from-sky-400/20 to-cyan-300/20 rounded-full flex items-center justify-center mx-auto">
            <svg className="w-8 h-8 text-sky-400/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-2">
            {t("post").noComments}
          </h3>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            来发表第一条评论吧
          </p>
        </div>
      ) : (
        <ul className="mb-6 space-y-4">
          {initialComments.map((c) => (
            <li
              key={c.id}
              className="ba-card p-4 transition-all duration-300 hover:shadow-lg"
            >
              <div className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words mb-3">
                {c.bodyText}
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span className="inline-flex items-center gap-1">
                  <span className="text-sky-500">💬</span>
                  {new Date(c.createdAt).toLocaleString(locale === "zh-CN" ? "zh-CN" : "en-US")}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="ba-card p-6">
        <h3 className="mb-4 text-lg font-semibold text-slate-800 dark:text-slate-100">
          {t("post").writeComment}
        </h3>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <textarea
            id="comment-body"
            name="bodyText"
            rows={4}
            maxLength={maxLength}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("post").commentPlaceholder.replace("{{min}}", "2").replace("{{max}}", String(maxLength))}
            className="w-full resize-y rounded-lg border border-slate-300 bg-white/80 px-4 py-3 text-sm text-slate-800 shadow-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-100 transition-all duration-300"
          />
          {captchaSiteKey && <div ref={widgetRef} className="cf-turnstile" />}
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-500 dark:text-slate-400">
              {text.length}/{maxLength}
            </span>
            <button
              type="submit"
              disabled={pending}
              className="ba-button-primary px-6 py-2 text-sm font-medium transition-all duration-300 hover:shadow-lg disabled:opacity-60"
            >
              {pending ? t("post").submitting : t("post").submitComment}
            </button>
          </div>
          {error ? (
            <div className="ba-card p-3 text-center">
              <p className="text-sm text-rose-600 dark:text-rose-400">
                {error}
              </p>
            </div>
          ) : null}
          {success ? (
            <div className="ba-card p-3 text-center">
              <p className="text-sm text-emerald-600 dark:text-emerald-400">
                {success}
              </p>
            </div>
          ) : null}
        </form>
      </div>
    </section>
  );
}
