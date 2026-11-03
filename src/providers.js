// Builtin web-search / web-fetch providers for chatluna-plugin-web-search.
// A provider is a plain object:
//   {
//     id: string,
//     label: string,                    // human-readable, shown in tool descriptions
//     kinds: ("search" | "fetch")[],    // capabilities it serves
//     search?({ query, count }, signal) → SearchResult[]
//     fetch?({ url }, signal)          → { title, content }
//   }
// Register custom providers via `ctx.search.register(provider)` — see README.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const STRIP_TAGS = (html) => html
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ")
  .trim();

/** Normalize one search hit. Extra provider fields are passed through. */
export function hit(title, url, extra = {}) {
  return { title, url, ...extra };
}


/** Read a key from DSH's credential store so ChatLuna reuses the same vault. */
function dshCredential(key) {
  try {
    const text = readFileSync(join(homedir(), ".dsh", ".credentials.yaml"), "utf8");
    const m = text.match(new RegExp(`^\\s*${key}:\\s*(\\S+)`, "m"));
    return m?.[1];
  } catch { /* absent */ }
}

export function resolveKey(configValue, envName) {
  return configValue || process.env[envName] || dshCredential(envName);
}

// ---------- DeepSeek official Search / Fetch APIs ----------
// https://api-docs.deepseek.com/zh-cn/guides/search
// Search: POST {base}/v1/tools/search {query, count, need_content}
// Fetch:  POST {base}/v1/tools/fetch  {url}
export function deepseekProvider({ apiKey, baseUrl }) {
  const base = (baseUrl ?? "https://api.deepseek.com").replace(/\/$/, "").replace(/\/v1$/, "");
  const headers = { "content-type": "application/json", authorization: `Bearer ${apiKey}` };
  return {
    id: "deepseek",
    label: "DeepSeek Search/Fetch (官方 API，¥5/千次)",
    kinds: ["search", "fetch"],
    async search({ query, count }, signal) {
      const resp = await fetch(`${base}/v1/tools/search`, {
        method: "POST",
        headers,
        body: JSON.stringify({ query, count, need_content: false }),
        signal,
      });
      if (!resp.ok) throw new Error(`DeepSeek Search HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
      const data = await resp.json();
      return (data.results ?? []).map((r) => hit(r.title, r.url, {
        snippet: r.summary || r.snippet || "",
        date: r.date ?? undefined,
        authority: r.authority,
        score: r.rerank_score,
      }));
    },
    async fetch({ url }, signal) {
      const resp = await fetch(`${base}/v1/tools/fetch`, {
        method: "POST",
        headers,
        body: JSON.stringify({ url }),
        signal,
      });
      if (!resp.ok) {
        let msg = (await resp.text()).slice(0, 300);
        try { msg = JSON.parse(msg).error?.message ?? msg; } catch { /* keep */ }
        throw new Error(`DeepSeek Fetch HTTP ${resp.status}: ${msg}`);
      }
      const data = await resp.json();
      return { title: data.title ?? "", content: data.content ?? "" };
    },
  };
}

// ---------- Tavily ----------
export function tavilyProvider({ apiKey }) {
  return {
    id: "tavily",
    label: "Tavily (免费档 1k 次/月)",
    kinds: ["search"],
    async search({ query, count }, signal) {
      const resp = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ api_key: apiKey, query, max_results: count, search_depth: "basic" }),
        signal,
      });
      if (!resp.ok) throw new Error(`Tavily HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
      const data = await resp.json();
      return (data.results ?? []).map((r) => hit(r.title, r.url, { snippet: r.content ?? "", date: r.published_date }));
    },
  };
}

// ---------- plain fetch (no key, no quota) ----------
export function plainFetchProvider() {
  return {
    id: "plain",
    label: "Raw fetch（直连抓取，去标签）",
    kinds: ["fetch"],
    async fetch({ url }, signal) {
      const resp = await fetch(url, {
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; chatluna-web-search/1.0)",
          accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
        },
        redirect: "follow",
        signal: AbortSignal.any([signal, AbortSignal.timeout(20000)].filter(Boolean)),
      });
      if (resp.status >= 400) throw new Error(`HTTP ${resp.status}`);
      return { title: "", content: STRIP_TAGS(await resp.text()) };
    },
  };
}
