# 公开公司新闻归档

归档只读取 FinHot 已公开 HTTP 资讯接口及已经核验所属域名的公司官方 RSS/Atom。**不读取 SSH、数据库、私有候选 `data/ventures/candidates.json`，不发起模型请求。** 页面使用构建期生成的静态数据，读者访问不会触发 FinHot/D1 查询。

```sh
npm run ventures:news                 # 6 小时内复用输入缓存；重新按当前公司名单匹配
npm run ventures:news -- --refresh    # 刷新公开接口及官方 feeds
npm run ventures:news -- --full       # 首次/补录时不加增量时间过滤
npm run test:ventures                 # 离线匹配、来源、解析和关系证据测试
```

- `official-feeds.json`：官方 feed、明确的公司 ID、允许的来源域名、核验日期。当前为 OpenAI、NVIDIA 和 Google DeepMind，2026-10-23 实际 HTTP 200 且解析成功。官网内容仅取原题、链接、来源、发布日期，不复制正文或 RSS 描述。
- `public-history.json`：经过字段白名单处理的公开元数据历史。保存尚未匹配公司的条目，后续扩充公司后可重算归档。保留 180 天，至多 20,000 条；没有私有文章正文或访谈记录。
- `metadata.json`：各源最近获取时间、成功/失败、分页上限与截断情况、输入指纹。
- `exclusions.json`：人工撤下的公开文章 ID。撤稿/误归类时加入 IDs，再生成与部署；FinHot 的历史文章退出公开池不会自动对本地历史发删除通知，因此不能把归档解释为当前仍在上游公开池的完整镜像。
- `../../public/data/venture-news.json`：页面使用的静态匹配结果。归档不会强行转换为公司事实或融资事件，已核实事件仍单独维护在 YAML。

## 范围与匹配口径

目前 FinHot 公开 API 只列金融域（`finance`），未公开的 AI 域不在导入范围。首次最多读取 50 页、每页 20 条，后续使用上次成功时间前 48 小时的重叠窗口，仍受 1,000 条上限限制。达到上限会明确标记 `truncated`；这是一个有边界的公开新闻索引，不是全网历史完整库。晚到超过重叠窗口的旧新闻需要 `--full` 回补，并仍可能受公开接口的近期窗口限制。

- 原标题命中：按原始标题识别公司，可一篇关联多家公司。
- 摘要提及：仅摘要出现的名字单独标记，不当作标题主角或公司公告。
- 官方渠道：标题可能不含自身名字，通过预先核验的 feed 所属公司归档，标记 `official`。官方博客可能包含行业观点，不能自动推断为已确认的交易、客户或融资事实。
- 英文按词边界，短缩写有白名单；常见词只在标题存在相关技术/公司上下文时使用，通用单词如 Figure/ARM 不单独识别。`match` 是编辑指定的替代匹配词，会覆盖 name/en/aliases；共享歧义别名不归到任何一家。
- 同一原文 URL 去掉常见跟踪参数后去重，跨公司保留多重关联。匹配是确定性规则，仍可能有误报/漏报。

任何一个来源失败会保留其旧公开历史并记录 `degraded` 和错误；全部来源失败则退出，不覆盖既有归档。自动化应同时提交 `public-history.json`、`metadata.json` 和静态结果，再构建部署。`--input path.json` 是离线重放模式，要求包含 `version:1, source:'finhot-public-api', endpoint:'https://finhot.fun/api/items', fetchedAt, items`；它不访问官方 feeds，也拒绝私有 candidates 文件。

`archiveCoverage` 会持久记录初始回溯是否截断，以及后续截断窗口与旧记录完全不重合时发现的潜在历史缺口。成功抓到新一期不会清除这些历史标记；`lastCompleteFetchAt` 只在该次查询没有分页截断时推进，与实际抓取时间 `fetchedAt` 分开。固定总容量下优先保留已关联公司的资讯，再存未关联的公开元数据，避免普通财经条目挤掉公司历史。
