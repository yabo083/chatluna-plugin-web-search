// web_search / web_fetch tools — thin consumers of ctx.search.
// The subject forwarded to the quota layer is the tool call's actor
// ({ platform, user, ... }); absent actor → global bucket.
import { Schema } from "@satorijs/core";

export function defineTools(ctx, tools, svc) {
  const searchProviders = svc.providers("search").map((p) => p.id);
  const fetchProviders = svc.providers("fetch").map((p) => p.id);

  tools.define({
    name: "web_search",
    description: `Search the web. Providers: ${searchProviders.join(", ") || "none"}. Returns structured hits (title/url/snippet/date); read a promising hit with web_fetch.`,
    args: Schema.object({
      query: Schema.string().required().description("Search query."),
      provider: searchProviders.length > 0 ? Schema.union(searchProviders).description(`Search backend; default ${svc.defaults.search}.`) : Schema.string().description("Search backend."),
      count: Schema.natural().description("How many results (1-50, default 10)."),
    }),
    traits: { parallel: true, effect: "read" },
    async run(input, call) {
      const hits = await svc.query(input.query, {
        provider: input.provider,
        count: input.count ?? 10,
        subject: call.actor,
        signal: call.signal,
      });
      return { results: hits };
    },
  });

  tools.define({
    name: "web_fetch",
    description: `Fetch a web page as text/Markdown. Providers: ${fetchProviders.join(", ")} (plain = raw GET + tag strip; deepseek = official Fetch API, Markdown).`,
    args: Schema.object({
      url: Schema.string().required().description("The page URL to fetch."),
      provider: Schema.union(fetchProviders).description(`Fetch backend; default ${svc.defaults.fetch}.`),
      maxChars: Schema.natural().description("Max characters of text to return. Default 8000, capped at 12000."),
    }),
    traits: { parallel: true, effect: "read" },
    async run(input, call) {
      const limit = Math.min(Math.max(input.maxChars ?? 8000, 500), 12000);
      const page = await svc.fetch(input.url, {
        provider: input.provider,
        subject: call.actor,
        signal: call.signal,
      });
      return { url: input.url, title: page.title ?? "", text: (page.content ?? "").slice(0, limit) };
    },
  });

  ctx.logger("chatluna-web-search").info(
    `tools registered (search: ${searchProviders.join("+") || "none"}, fetch: ${fetchProviders.join("+")})`
  );
}
