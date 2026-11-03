# chatluna-plugin-web-search

ChatLuna v2 的共享网络搜索服务。把「搜索/抓取」从工具层抽到服务层：
`ctx.search` 作为一等服务挂在 cordis context 上，provider 是可注册的 seam，
工具、引擎、其他插件消费同一接口，密钥与配额在服务层统一管理。

## 架构

```
web_search / web_fetch 工具        其他插件 / 引擎
        │                              │
        └────────────►  ctx.search  ◄──┘
                 (SearchService: provider registry + quota)
                          │
        ┌─────────────────┼─────────────────┐
   deepseek            tavily            plain
   (Search+Fetch      (Search)         (fetch only,
    官方 API)                           免 key 免配额)
```

```js
// 插件方消费方式
const hits = await ctx.search.query("霞沢ミユ プロフィール", { count: 5, subject });
const page = await ctx.search.fetch(url, { provider: "deepseek", subject });

// 注册自定义 provider（任何插件可注入后端）
ctx.search.register({
  id: "serper",
  kinds: ["search"],
  async search({ query, count }, signal) { /* …→ [{title,url,snippet}] */ },
});
```

- **`kinds`**：`"search" | "fetch"`，一个 provider 可实现两者（如 deepseek）。
- **BYOK**：`deepseekApiKey` / `tavilyApiKey` 进 `config:` 即可；留空依次读环境变量
  `DEEPSEEK_API_KEY` / `TAVILY_API_KEY`，再读 DSH 凭据库 `~/.dsh/.credentials.yaml`。
- **配额**：`call.actor`（`{platform,user}`）经 `ctx.permissions.levelOf` 判级；
  level < `freeQuotaLevel` 的主体共享 `freeDailyLimit` 次/天（UTC）。level 解析失败即 fail closed。

## 安装

```yaml
# chatluna.yml 插件条目
- id: web-search
  name: chatluna-plugin-web-search        # npm 发布前用 file:///abs/path/src/index.js
  config:
    deepseekApiKey: sk-…                  # 可选，留空读 env/DSH 凭据
    tavilyApiKey: tvly-…                  # 可选
    defaultProvider: deepseek             # web_search 默认源
    defaultFetchProvider: plain           # web_fetch 默认源
    freeDailyLimit: 20                    # 低权限主体日配额，0 = 不限
    freeQuotaLevel: 4                     # level ≥ 4 免配额
```

## 工具

| 工具 | 参数 | 说明 |
|---|---|---|
| `web_search` | `query, provider?, count≤50` | 返回 `{results:[{title,url,snippet,date,…}]}` |
| `web_fetch` | `url, provider?, maxChars≤12000` | `plain`=裸 GET 去标签；`deepseek`=官方 Fetch API 返回 Markdown |

Provider 端点：

- **deepseek**：`POST /v1/tools/search`、`POST /v1/tools/fetch`（[官方文档](https://api-docs.deepseek.com/zh-cn/guides/search)，¥5/千次，支持 `site:`/`lang:`/`after:` 语法）
- **tavily**：`POST api.tavily.com/search`（免费档 1k 次/月）
- **plain**：直接 GET + HTML 去标签，零成本、无配额

## 设计意图（给上游 RFC 的生产依据）

v2 目前只有 `ctx.tools.define` 这个扩展面，没有 provider 抽象——搜索是个 service 不是 tool。
本包即构想的工作参照：`ctx.search` seam、provider registry、BYOK + 配额。
蒸馏/摘要属于**消费侧**（setup 引擎、RAG、问答插件各自按需接自己的 LLM），不进基础设施。

## License

AGPL-3.0
