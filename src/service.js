// ctx.search — shared web-search/web-fetch service for ChatLuna v2.
// Tools, engines and plugins all consume one seam; provider backends are a
// registry, keys and quota are managed once here.
//
//   ctx.search.register(provider)          → dispose
//   ctx.search.providers(kind?)            → provider[]
//   ctx.search.query(q, { provider, count, subject })  → hits[]
//   ctx.search.fetch(url, { provider, subject })       → { title, content }
import { Service } from "cordis";

const DAY_MS = 86400e3;

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export class SearchService extends Service {
  _providers = new Map();
  _usage = new Map(); // `${subjectKey}:${day}` → count
  defaults = {};

  constructor(ctx, config) {
    super(ctx, "search");
    this.config = config;
  }

  /** Register a provider object (see providers.js for the shape). Returns a dispose function. */
  register(provider) {
    if (!provider?.id) throw new Error("provider.id is required");
    if (!Array.isArray(provider.kinds) || provider.kinds.length === 0) throw new Error(`provider ${provider.id}: kinds required`);
    if (this._providers.has(provider.id)) throw new Error(`duplicate provider: ${provider.id}`);
    this._providers.set(provider.id, provider);
    this.ctx.logger("search").info(`provider registered: ${provider.id} (${provider.kinds.join(",")})`);
    return () => this._providers.delete(provider.id);
  }

  /** List providers, optionally filtered by capability ("search" | "fetch"). */
  providers(kind) {
    const all = [...this._providers.values()];
    return kind === undefined ? all : all.filter((p) => p.kinds.includes(kind));
  }

  provider(id, kind) {
    const p = this._providers.get(id);
    if (p === undefined || (kind !== undefined && !p.kinds.includes(kind))) {
      const available = this.providers(kind).map((x) => x.id).join(", ") || "none";
      throw new Error(`search provider "${id}" unavailable for ${kind ?? "any"}; available: ${available}`);
    }
    return p;
  }

  /**
   * Quota: subjects below `freeQuotaLevel` share `freeDailyLimit` successful
   * calls per calendar day (UTC). Level resolution goes through
   * ctx.permissions when available; unknown/no subject → level 0 (quota applies).
   */
  async subjectLevel(subject) {
    if (subject === undefined) return 0;
    const permissions = this.ctx.get("permissions");
    if (permissions === undefined) return 5; // no permission service → no quota enforcement
    try {
      return await permissions.levelOf(subject);
    } catch {
      return 0;
    }
  }

  async takeQuota(subject) {
    const limit = this.config.freeDailyLimit ?? 0;
    if (limit <= 0) return;
    const level = await this.subjectLevel(subject);
    if (level >= (this.config.freeQuotaLevel ?? 4)) return;
    const subjectKey = subject === undefined ? "*" : `${subject.platform ?? ""}:${subject.user ?? ""}`;
    const key = `${subjectKey}:${todayKey()}`;
    const used = this._usage.get(key) ?? 0;
    if (used >= limit) {
      throw new Error(`daily free quota exhausted (${limit}/day); add an API key of your own or ask the owner`);
    }
    this._usage.set(key, used + 1);
    // bound the map: drop stale days lazily
    if (this._usage.size > 1024) {
      const day = todayKey();
      for (const k of this._usage.keys()) if (!k.endsWith(day)) this._usage.delete(k);
    }
  }

  /**
   * Search the web.
   * @param {string} query
   * @param {{ provider?: string, count?: number, subject?: object, signal?: AbortSignal }} opts
   */
  async query(query, opts = {}) {
    const provider = this.provider(opts.provider ?? this.config.defaultProvider, "search");
    const count = Math.min(Math.max(opts.count ?? 10, 1), 50);
    await this.takeQuota(opts.subject);
    return provider.search({ query, count }, opts.signal);
  }

  /**
   * Fetch a page as text/Markdown.
   * @param {string} url
   * @param {{ provider?: string, subject?: object, signal?: AbortSignal }} opts
   */
  async fetch(url, opts = {}) {
    const provider = this.provider(opts.provider ?? this.config.defaultFetchProvider, "fetch");
    await this.takeQuota(opts.subject);
    return provider.fetch({ url }, opts.signal);
  }
}
