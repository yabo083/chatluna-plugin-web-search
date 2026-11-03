// chatluna-plugin-web-search
// Shared web-search service (ctx.search) + builtin providers
// (DeepSeek / Tavily / plain fetch) + web_search / web_fetch tools.
import { Schema } from "@satorijs/core";
import { SearchService } from "./service.js";
import { deepseekProvider, plainFetchProvider, resolveKey, tavilyProvider } from "./providers.js";
import { defineTools } from "./tools.js";

export const name = "chatluna-web-search";

export const Config = Schema.object({
  tavilyApiKey: Schema.string().role("secret").label("Tavily API Key").description("tvly-… 留空则读环境变量 TAVILY_API_KEY 或 DSH 凭据库。"),
  deepseekApiKey: Schema.string().role("secret").label("DeepSeek API Key").description("sk-… Search/Fetch 官方 API 共用。留空读 DEEPSEEK_API_KEY 或 DSH 凭据库。"),
  deepseekBaseUrl: Schema.string().default("https://api.deepseek.com").label("DeepSeek Base URL"),
  defaultProvider: Schema.union(["deepseek", "tavily"]).default("deepseek").label("默认搜索源").description("web_search 缺省 provider。"),
  defaultFetchProvider: Schema.union(["plain", "deepseek"]).default("plain").label("默认抓取源").description("web_fetch 缺省 provider；plain 免配额，deepseek 返回 Markdown（计费）。"),
  freeDailyLimit: Schema.natural().default(20).label("免费档日配额").description("每个低权限主体每天最多发起的搜索/抓取次数；0 表示不限。"),
  freeQuotaLevel: Schema.natural().default(4).label("免配额等级").description("permission level ≥ 此值的主体不受日配额限制。"),
  exposeTools: Schema.boolean().default(true).label("注册工具").description("把 web_search / web_fetch 注册为模型可用工具；关闭则只提供 ctx.search 服务。"),
});

export const inject = { required: [], optional: ["tools", "permissions"] };

export async function apply(ctx, config) {
  await ctx.plugin(SearchService, config);
  const svc = ctx.get("search");

  const dsKey = resolveKey(config.deepseekApiKey, "DEEPSEEK_API_KEY");
  const tavilyKey = resolveKey(config.tavilyApiKey, "TAVILY_API_KEY");
  if (dsKey) svc.register(deepseekProvider({ apiKey: dsKey, baseUrl: config.deepseekBaseUrl }));
  if (tavilyKey) svc.register(tavilyProvider({ apiKey: tavilyKey }));
  svc.register(plainFetchProvider());

  // Configured default wins; fall back to whatever is registered so a
  // missing key never bricks the service.
  svc.defaults = {
    search: svc.providers("search").some((p) => p.id === config.defaultProvider)
      ? config.defaultProvider
      : svc.providers("search")[0]?.id,
    fetch: svc.providers("fetch").some((p) => p.id === config.defaultFetchProvider)
      ? config.defaultFetchProvider
      : svc.providers("fetch")[0]?.id,
  };

  const tools = ctx.get("tools");
  if (config.exposeTools && tools !== undefined) defineTools(ctx, tools, svc);
}
