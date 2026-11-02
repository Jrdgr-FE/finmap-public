# FinMap · 硬科技产业与金融机构图谱

> **公开版说明**：这是 FinMap 脱敏后的公开快照，不含提交历史，也不随线上自动更新。
> 公司动态的接口地址已换成占位符 `monitor.example.com`（`functions/api/monitor.js`、`astro.config.mjs`、`scripts/monitor-snapshot.mjs`），
> 运维记录已移除，`.github/workflows/deploy.yml` 只能手动触发。自行部署时请换成自己的采集服务地址和 Cloudflare 账号。

> **2026-10-28 工作台完善**：新增关键进展、证据状态、本次新增和可恢复隐藏；关注与收藏支持本机备份、预览及合并恢复。公司库使用独立小索引，减少约 91% 下载量。修正部分行情噪声与无日期历史排序，并更新静态构建依赖。见本轮验收记录。

> **2026-10-26 公司监测版**：首页改为[公司动态工作台](https://map.finhot.fun/)，支持按公司、赛道、环节、时间和事件类别筛选，以及本机关注、已读、收藏。现有 247 家公司登记在册，246 家已完成至少一个公开渠道检查；1 家正式名称尚未公开，暂不监测。英国服务器定时采集，Cloudflare 只分发页面与缓存快照，不使用 D1，不调用摘要模型。重点部件公司每小时检查，普通公司每 6 小时检查；页面可见时每 5 分钟刷新结果。公开新闻检索是线索，不能视为全文核验或全网覆盖。
>
> [监测覆盖](https://map.finhot.fun/ventures/monitoring/)显示每个渠道的最近成功、失败和缺口；X、公众号尚未完整自动接入。规则与部署见公司监测运维说明，产品要求见需求文档。金融概览保留在 `/financial/`。下方旧版本说明仅作历史参考。

> **2026-10-23 产业研究版**：硬科技板块现有 221 家公司、12 个赛道、43 个环节，支持跨赛道归属、产业链筛选、CSV 导出、公司档案和公开新闻归档。每 6 小时经 GitHub Actions 刷新公开新闻并部署。金融机构资料保留。当前为持续扩展的样本库，非全球完整名册；新闻历史有有限抓取窗口。
>
> 页面：[产业图谱](https://map.finhot.fun/ventures/) · [公司新闻](https://map.finhot.fun/ventures/news/) · [覆盖口径](https://map.finhot.fun/ventures/coverage/)
>
> 实现、边界、验证与维护：[硬科技 mapping 说明](docs/hardtech-mapping-20261023.md)。使用 `npm run test:ventures`、`npm run check` 和 `npm run validate` 检查，`npm run ventures:news -- --refresh` 刷新公开归档。下方早期金融图谱数字和初始硬科技设计保留作历史说明；现行结构以此说明为准。

把中国的金融机构按牌照分类摊开，再把集团内部的控股链条画出来。

```bash
npm install
npm run dev        # http://localhost:4321
npm run validate   # 数据自检
npm run report     # 覆盖报告 + 与官方名单逐类对账
npm run build      # 静态站输出到 dist/
```

---

## 它解决什么问题

网上能查到"中国有哪些银行"，但查不到"招商银行那 26.32% 是谁持的、穿过几条通道"。
官方名单是公开的，但它们是**平铺的 PDF**——四千多家法人机构排成一张巨表，
没有集团内部的持股结构，也不区分谁有牌照、谁只是挂个名。

这个项目做四件事：

1. **按牌照分类** —— 口径对齐人行《金融机构编码规范》与银发〔2015〕309 号
2. **画控股谱系** —— 谁持谁、持多少、哪些是控股哪些只是品牌关联
3. **每个数字都能点回来源** —— 持股比例标口径、标时点，查不到就留空
4. **跟官方名单对家数** —— 一条命令看出哪个牌照序列还漏着，缺哪些机构

## 数据规模

| | |
|---|---|
| 持牌法人主体 | 4,959 |
| 其中逐一核实详情 | 1,314（有官网、业务、股权、完整来源） |
| 其中名册级 | 3,645（名称、机构编码、牌照类型、属地） |
| 金融分类 / 牌照类型 | 8 / 50+ |
| 有股权谱系的集团 | 4（中信、中国平安、招商局、光大） |
| 去重来源 | 1,483 |
| 已核实机构编码 | 4,274 |
| 已核实官网 | 1,183 |
| 输出页面 | 4,978（构建约 6 秒） |

## 三层结构 + 两档深度

```
监管与基础设施层     42 家   定规则、发牌照、办登记清算
集团谱系层           90 家   4 个金融集团，带股权边（谁持谁、持多少）
全牌照名录制      4,700+ 家  按牌照序列收全的机构名册
```

**为什么分三层。**「谁持有牌照」和「谁持有了谁」是两个不同的问题，
用同一张表表达会两头都不讨好。名录制回答"这个牌照序列里有哪些机构"，
谱系层回答"这些机构在集团内部怎么挂"。

**为什么又分两档深度。** 农村商业银行一个序列就 1,505 家、村镇银行 1,440 家，
逐个上网核实官网和经营情况不现实。所以：

- `tier: detailed` —— 核实过官网、业务、股权，有完整详情页 → `/orgs/`
- `tier: mass` —— 从监管名单批量导入，只保留能确定的事实 → `/roster/`

把两者混在一起展示，会让读者以为名册级那些也核实过。所以页面上用「名册」标记区分，
各自走各自的列表页。

## 目录结构

```
data/
  taxonomy.yaml            # 分类骨架：8 个分类 + 50 余个牌照类型
  highlights.yaml          # 编辑内容：几个容易搞错的事实，同样挂来源
  roster-reference.json    # 银行业官方名单基线（4,070 家）
  insurance-reference.json # 保险业官方名单基线（238 家）
  supervision.yaml         # 监管与基础设施层
  groups/                  # 集团谱系层：citic / pingan / merchants / everbright
  registry/                # 全牌照名录制，每个牌照序列一个文件
src/
  lib/data.ts        # 数据加载 + 构建期校验 + 名录制去重 + 正文兜底清理
  lib/tree.ts        # 谱系树布局算法
  components/        # LineageGraph / OrgRow / SourceList / SiteSearch（全站搜索）
  pages/             # index / orgs / roster / groups / group / org / category / about
                     # search.json.ts：构建期生成全站搜索索引
scripts/
  validate.mjs               # 数据自检
  report.mjs                 # 覆盖报告 + 官方基线逐类对账
  import-nfra-roster.mjs     # 从监管名单 PDF 批量导入名册级机构
```

## 数据模型

```yaml
- id: citic-bank
  name: 中信银行股份有限公司
  short: 中信银行
  category: banking                          # 必须是 taxonomy 里的分类
  type: joint-stock-commercial-bank          # 必须是该分类下的类型
  license_code: B0006H111000001              # 机构编码，必须写成字符串
  regulator: 国家金融监督管理总局
  region: 全国                                # 名册级记录用来分组
  founded: 1987
  listed: ["601998.SH", "0998.HK"]
  website: https://www.citicbank.com
  intro: >-
    全国 12 家股份制商业银行之一……
  business: [公司银行, 投资银行, 交易银行]
  parent: citic-holdings                     # 上层主体 id，直接归集团写 ROOT
  stake: 64.95                               # 上层持股比例
  stake_asof: "2025-02-14"                   # 非全资比例必须标时点
  stake_basis: aggregate                     # aggregate = 集团多通道合计口径
  held_via: 中信集团直接持股 + 中信金控……     # aggregate 必须写清通道
  relation: affiliate                        # affiliate = 参股／品牌关联，不控股
  status: active                             # active | distressed | exited | merging
  tier: detailed                             # detailed | mass
  sources:
    - { title: "…", url: "https://…", date: "2025-02-14" }
```

## 质量闸门

### 一、构建期校验（不过就构建失败）

```bash
npm run validate
```

| 规则 | 为什么 |
|---|---|
| `category`/`type` 必须存在且互相匹配 | 防止「银行业」下面挂「信托公司」 |
| 机构 id 全局唯一 | 跨集团不能重名 |
| `parent` 不能悬空 + 环检测 | 防止 A 持 B、B 持 A |
| 每个主体至少一条来源，URL 必须合法 | 「点回来源」不能是空头承诺 |
| 非 100% 持股比例必须有 `stake_asof` | 比例是时点数据 |
| `stake_basis: aggregate` 必须有 `held_via` | 「合计」不写通道就没法复核 |
| `status` 非 active 必须说明退出情形 | 已退出的主体不能混在现役里 |
| `tier: mass` 必须有 `region` | 名册级靠属地分组展示 |
| **`license_code` 必须是字符串且格式合法** | 写成裸数字会被 YAML 当整数，`000017` 变成 `17`，前导零全丢——真踩过 |

缺 `stake_asof` 进**警告**而不是错误——编一个日期比留个缺口更糟，
界面会把这类比例标上 `*`。

### 二、与官方名单逐类对账

```bash
npm run report
```

两份基线都来自对监管总局官方 PDF 的解析，逐条含机构编码与类型：

- 银行业：《银行业金融机构法人名单》（截至 2025-06-30，4,070 家法人）
- 保险业：《保险机构法人名单》（截至 2025-06-30，238 家法人）

报告逐类对账并列出缺口机构名；没有全量基线的序列（公募基金、期货、证券公司、地方 AMC）
按官方公布家数做回归检查：

```
  牌照类型                      官方    已收     漏
  rural-commercial-bank   1505  1505     0
  village-bank            1440  1440     0
  …
✓ 官方名单覆盖的每一个牌照序列都已收全。
```

基线有截止日期，之后发生的合并、更名会让个别条目"看起来缺了"。
这类情况在脚本里单独列了白名单并写明理由，不计入缺口：

- 中邮邮惠万家银行（已被邮储银行吸收合并，直销银行 2→1）
- 新疆汇和银行（已被新疆银行吸收合并，城商行 124→123）

## 名册级批量导入

`scripts/import-nfra-roster.mjs` 把监管名单 PDF 转成 YAML：

```bash
pdftotext -layout 名单.pdf roster.txt
node scripts/import-nfra-roster.mjs roster.txt --write
```

解析上有四个坑，都是踩过才定下来的：

1. **行解析不可靠** —— 大表的行会跨行、列会错位，用行正则只能解析出 1,886 家（真值 4,070）
2. **要以机构编码为锚点** —— 先在全文定位编码，再取其后 60 字符窗口确定牌照类型与监管单位
3. **名称不在编码紧前面** —— 中间夹着英文名，要往前找最后一个「序号 + 中文名」对；
   紧贴编码取只能拿到 46%
4. **名称可能折行到序号之前** —— 此时"编码前最后一个序号+中文名"会命中上一行编码的后 4 位
   和本行的类型标签，把「村镇银行」当成机构名。加 `(?<!\d)` 拒绝从编码中间截断的匹配

保险业的《保险机构法人名单》格式不同：机构类型会折成两三行（`保险集团（控股）` / `公司`），
要以连续前缀匹配而不是完整标签。

## 设计取舍

**只收持牌法人，不收分支机构。** 一家银行的分行不是法人，不进图谱。
唯一例外是外国再保险公司在华分公司——它们是境内再保险供给的主要通道，
收了，但每条都写明分公司性质与境外法人母体。

**区分控股与非控股。** 谱系图实线是控股或实际控制，虚线是参股或只有品牌关联。
中信建投挂着「中信」字号，但中信证券 2019 年已经清仓减持，现在第一大股东是北京金融控股集团。

**状态分三档而不是两档。** 被接管、破产重整的主体（华信信托、新时代信托、华泰汽车金融）
法人资格还在、还有重整复活的可能性，和已经注销的村镇银行不是一回事，
所以 `distressed` 与 `exited` 分开，界面标记也不同。

**手写 SVG 而不是引入图可视化库。** 集团谱系本质是层次树，不是力导向图。
这里用左右向层次布局：x 轴是层级，y 轴按叶子顺序排，父节点纵向居中于其子树，
行距按叶子数自适应。构建后有几何校验：0 重叠、0 越界、0 文字溢出。

**明确不收录的类别，连同理由一起写进分类。** 典当行、地方交易场所保留在 taxonomy 里
但标注 `outOfScope` 与原因，`npm run report` 会把它们与真正的缺口分开显示。
把类别悄悄删掉，对找典当行的读者没有任何帮助。

**为什么单设「金融控股公司」分类。** 它决定了整张图谱长什么样：
有金控牌照的集团（中信、招商局）金融股权收拢到一个平台，谱系是一棵树；
没有的（中国平安）股权散挂在集团本级，谱系是一片灌木。
各省叫「XX金融控股集团」的平台绝大多数并没有央行金控牌照，所以按有无牌照分列。

## 已知局限

- 有股权谱系的只有 4 个集团，四大行、保险系、互联网系的谱系未做
- 名册级 3,645 家没有官网与经营情况，这是刻意的取舍，不是遗漏
- 「某集团没有某项牌照」只能给出「我没查到」，不能给出「不存在」
- 股权每年在变，页面标注的日期就是数据新鲜度
- 保险中介（上千家）与私募基金管理人（上万家）不在范围内
- 境外机构、融资租赁、私募管理人这几类归类存在争议，处理方式写在对应页面的「需要说明」里

## 界面

2026-10-20 改版：原来的纸感底色、英文等宽小标题和大段说明读起来像个人笔记，改成与 finhot.fun、Lab Gateway 控制台同一套设计令牌（中性灰底、白色面板、紫色强调色、系统字体），三个站点属于同一产品家族。

- 页头全站搜索（`/` 或 ⌘K），覆盖全部 4,959 家：名称、简称、机构编码、上市代码、属地。索引 `/search.json` 构建期生成（约 760 KB，压缩后约 100 KB），首次聚焦时才下载；逐一核实的排在名册级前面。
- 导航：机构库（`/orgs/`）、全量名册（`/roster/`）、集团谱系（新增 `/groups/`）、数据说明。两个列表页支持 `?q=` 带关键词进入，与原有 `?cat=`、`?type=` 一起用。
- 首页：搜索为主，下面是核心数字、8 个分类磁贴、4 个集团、「容易读错的几处」和三条数据口径；方法论细节移到数据说明页。
- 机构页改为档案式：顶部机构卡（分类、上市代码、状态、名册标记），左侧股权链（集团 → 中间层 → 本机构，逐层持股比例）、旗下主体、同类机构，右侧基本信息与来源。集团页与分类页同样改为面板布局，分类页的牌照类型分布改为条形图（区分逐一核实与名册级）。
- 数据说明页加目录，改用读者能看懂的说法（不再出现 YAML、npm 命令、字段名）；「已知局限」与「收录边界」对名册级序列的说法统一为「已按官方名单收全，未逐一核实」。
- 修正：名册页导航高亮落在「机构总览」上；机构行不再显示「全牌照名录」「监管与基础设施」这类数据集合名；分类页「按集团分布」只列真正的金融集团。

数据、URL 与收录口径未变；全部 4,979 个页面、10 万余条站内链接构建后核对无断链。

## 硬科技图谱

`/ventures/` 板块收录具身智能、世界模型等赛道的一级市场公司（头部公司也收），按产业链环节分类，每家公司附简介、估值和带来源的动态时间线。页面：`/ventures/`（总览）、`/ventures/<track>/`（赛道）、`/venture/<id>/`（公司）。

### 数据文件

`data/ventures/*.yaml`（目前是 `ventures.yaml`），结构为 `tracks`（赛道）→ `segments`（产业链环节）→ `companies`。代码在 `src/lib/ventures.ts`。

| 字段 | 说明 |
|---|---|
| `id` | 小写字母、数字、连字符；不能与金融机构 id 重名 |
| `name` / `en` | 中文名 / 英文名 |
| `region` | `cn` 或 `global` |
| `track` / `segment` | 所属赛道与产业链环节，必须在 `tracks` 里定义 |
| `tags` | 标签，参与全站搜索 |
| `intro` | 一两句简介 |
| `valuation` | `{ value, unit, asof, status }`，保留原币种，必须标时点 |
| `events` | `{ date, kind, title, status, sources }`；`kind` 为 funding / product / model / deployment / ipo / people；`status` 为 `confirmed`（官宣或多方确认）或 `reported`（传闻、单一来源） |

### 校验规则（`npm run validate`，不过就构建失败）

- id 格式合法、不重复、不与金融机构重名；`name`、`intro` 必填；`region` 只能是 cn / global
- `track`、`segment` 必须存在且对应；每个赛道至少一个环节
- 估值必须有 `asof` 和 `status`
- 公司须有可回查资料：已有事件档案保留事件；新增 `coverage: profile` 可先收录官网简介（必须有 `sources`、`verifiedAt`），不得编造新闻日期。事件 `date` 为 YYYY / YYYY-MM / YYYY-MM-DD，`kind`、`status` 合法，`title` 必填
- 每条事件至少一个来源，来源 URL 合法且有标题

### 候选动态

```bash
npm run ventures:candidates            # 默认最近 14 天
npm run ventures:candidates -- --days 30
```

通过 SSH（主机别名由环境变量 `FINHOT_SSH_HOST` 指定）只读查询 FinHot 的文章库，按公司名匹配出相关报道，写到 `data/ventures/candidates.json`（已 gitignore，不上线，含 FinHot 未公开的 AI 源文章，且匹配只看名字会有误报）。审核后把确认的事件连同来源写进 YAML。表名、列名可用环境变量覆盖：`FINHOT_ARTICLES_TABLE`、`FINHOT_COL_ID`、`FINHOT_COL_TITLE`、`FINHOT_COL_SUMMARY`、`FINHOT_COL_URL`、`FINHOT_COL_TIME`、`FINHOT_PUBLIC_EXPR`、`FINHOT_DB_URL_CMD`。

## 部署

线上地址：**https://map.finhot.fun**

```bash
npm run deploy   # = npm run build && wrangler pages deploy dist --project-name=finmap --branch=main
```

首次使用需要认证，二选一：

```bash
npx wrangler login                                  # OAuth，浏览器授权
export CLOUDFLARE_API_TOKEN=<你的 API Token>          # 或在环境里给 token
```

### 为什么不是 `cf deploy`

Cloudflare 新出的 `cf` CLI 是走「Pages on Workers」路线的，但有两个坑：

1. **`cf pages deploy` 已经不支持**，会直接报错让你改用 `cf deploy`（旧版 Pages 被弃用）
2. **`cf deploy` 只认 Vite 工程**。它的 Build Output Specification 期望
   `.cloudflare/output/v0/config.json`，而那个文件由 `@cloudflare/vite-plugin` 产出。
   Astro 自己的构建输出不符合，`cf build` 和 `cf deploy` 都会停在
   `no root config found at .cloudflare/output/v0/config.json`。
   `cf init .` 会自动跑 `astro add cloudflare` 加上 `@astrojs/cloudflare` 适配器，
   但仍然生成不出这个文件——这是 beta CLI 的框架适配范围问题，不是配置错。

所以本站用同一路线（Workers 静态资源）的稳定实现 `wrangler pages deploy`。
两者最终都是把纯静态目录托管在 Cloudflare 全球网络上，对这个站没有功能差别。

### 关于 workers.dev

如果要用 Workers 而非 Pages（`wrangler deploy` + `assets.directory`），
账号需要先注册一个 `workers.dev` 子域，否则会报
`You need to register a workers.dev subdomain before publishing to workers.dev`。
Pages 项目不需要这一步，URL 也更干净，所以选了 Pages。

### 部署前会自动经过的检查

`npm run build` 之前建议先跑 `npm run validate` 和 `npm run report`——
数据校验不过会导致构建直接失败，这是刻意的：宁可部署失败，也不要上线一份错数据。

## 免责

个人整理的结构化图谱，用于理解中国金融体系的牌照分布与集团治理结构，
不构成投资建议，也不构成对任何机构业务资质的认定。数据以监管机构公告与公司披露原文为准。
