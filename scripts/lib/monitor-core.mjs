import { createHash } from "node:crypto";
import { parseHTML } from "linkedom";
import sax from "sax";
import { publicUrl } from "./monitor-fetch.mjs";
import { compileAliases, matchCompanies } from "./venture-news-core.mjs";

export const KIND_LABELS = {
  funding: "融资并购",
  product: "产品发布",
  ranking: "榜单评测",
  partnership: "商业进展",
  people: "团队经营",
  research: "研究进展",
  other: "相关动态",
};
export const hash = (value) =>
  createHash("sha256").update(value).digest("hex").slice(0, 20);
export const plain = (value, max = 500) =>
  String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
export function sourceExcerpt(value) {
  if (!value) return "";
  const { document } = parseHTML(
    `<html><body>${String(value).slice(0, 18000)}</body></html>`,
  );
  for (const el of document.querySelectorAll("script,style,noscript,svg"))
    el.remove();
  return plain(document.body.textContent, 240);
}
export function isoDate(value, now = new Date().toISOString()) {
  if (!value) return null;
  let v = String(value)
    .trim()
    .replace(/年|\//g, "-")
    .replace(/月/g, "-")
    .replace(/日/g, "");
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(v)) {
    const [y, m, d] = v.split("-");
    v = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T00:00:00Z`;
  }
  if (/^(?:[A-Za-z.]+ \d{1,2},? 20\d{2}|\d{1,2} [A-Za-z.]+ 20\d{2})$/.test(v))
    v += " UTC";
  const time = Date.parse(v);
  if (
    !Number.isFinite(time) ||
    time > Date.parse(now) + 86400000 ||
    time < Date.parse("2000-01-01")
  )
    return null;
  return new Date(time).toISOString();
}
export function canonical(raw) {
  const safe = publicUrl(raw);
  if (!safe) return null;
  const u = new URL(safe);
  for (const k of [...u.searchParams.keys()])
    if (/^(utm_|spm$|fbclid$|gclid$)/i.test(k)) u.searchParams.delete(k);
  return u.href.replace(/\/$/, "");
}
export function parseFeed(xml, source, now) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || Buffer.byteLength(xml) > 2_500_000)
    throw new Error("unsafe_feed");
  const p = sax.parser(true, { trim: true }),
    stack = [],
    rows = [];
  let row = null,
    depth = 0,
    field = "",
    root = "";
  p.onopentag = (n) => {
    const tag = n.name.toLowerCase().split(":").at(-1);
    stack.push(tag);
    if (stack.length === 1) root = tag;
    if (["item", "entry"].includes(tag) && !row) {
      row = {
        title: "",
        link: "",
        published: "",
        pubdate: "",
        updated: "",
        source: "",
        summary: "",
        description: "",
        content: "",
        encoded: "",
      };
      depth = stack.length;
    } else if (row && stack.length === depth + 1) {
      field = Object.hasOwn(row, tag) ? tag : "";
      if (
        tag === "link" &&
        n.attributes.href &&
        (!n.attributes.rel || n.attributes.rel === "alternate")
      )
        row.link = String(n.attributes.href);
    }
  };
  const append = (t) => {
    if (row && field && stack.length === depth + 1) row[field] += t;
  };
  p.ontext = append;
  p.oncdata = append;
  p.onclosetag = () => {
    if (row && stack.length === depth) {
      rows.push(row);
      row = null;
      field = "";
    } else if (row && stack.length === depth + 1) field = "";
    stack.pop();
  };
  p.write(xml).close();
  if (!["rss", "feed", "rdf"].includes(root)) throw new Error("not_a_feed");
  return rows
    .map((r) => ({
      title: plain(r.title),
      url: canonical(r.link),
      publishedAt: isoDate(r.published || r.pubdate || r.updated, now),
      publisher: plain(r.source) || source.name,
      material: source.kind === "search" ? "search-title" : "official-title",
      excerpt:
        source.kind === "search"
          ? ""
          : sourceExcerpt(r.summary || r.description || r.content || r.encoded),
    }))
    .filter((r) => r.title && r.url && r.publishedAt);
}

const newsPath =
  /news|blog|press|media|article|stories|insights|updates|release|新闻|资讯|动态|媒体/i;
const skipLink =
  /privacy|terms|cookie|contact|career|login|signin|cart|政策|隐私|招聘|联系我们|登录/i;
const months =
  "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
function dateInText(text) {
  return (
    text.match(/20\d{2}[-年/.]\d{1,2}[-月/.]\d{1,2}日?/)?.[0] ??
    text.match(
      new RegExp(`${months}\\.?\\s+\\d{1,2},?\\s+20\\d{2}`, "i"),
    )?.[0] ??
    text.match(new RegExp(`\\b\\d{1,2}\\s+${months}\\.?\\s+20\\d{2}`, "i"))?.[0]
  );
}
export function isArticleUrl(url) {
  const pathname = new URL(url).pathname;
  return (
    /\/(?:news[^/]*|blog|press|articles?|stories)\/[^/?]+/i.test(pathname) &&
    !/\/(?:news|news-center|newsroom|media|press|blog|articles|stories|updates)\/?$/i.test(
      pathname,
    )
  );
}
export function pageIsReadable(page) {
  return (
    Boolean(page.title) &&
    page.text.length >= 100 &&
    !/just a moment|verify you are human|access denied|验证码|enable javascript to continue/i.test(
      page.title + " " + page.text.slice(0, 200),
    )
  );
}
export function parsePage(html, url, now) {
  if (/\.md(?:$|\?)/i.test(url) || /^\s*#{1,6}\s/.test(html))
    return parseMarkdown(html, url, now);
  // LinkeDOM's document.title/body getters require a document root, including for fragments.
  const { document } = parseHTML(
    /<html[\s>]/i.test(html) ? html : `<html><body>${html}</body></html>`,
  );
  const structured = [];
  for (const el of document.querySelectorAll(
    'script[type="application/ld+json"]',
  )) {
    try {
      structured.push(JSON.parse(el.textContent));
    } catch {}
  }
  function articleOf(x) {
    if (Array.isArray(x)) return x.map(articleOf).find(Boolean);
    if (x && typeof x === "object") {
      if (/Article|NewsArticle|BlogPosting/.test(String(x["@type"]))) return x;
      return articleOf(x["@graph"]);
    }
    return null;
  }
  const structuredArticle = structured.map(articleOf).find(Boolean);
  const meta = (key) =>
    document
      .querySelector(`meta[property="${key}"],meta[name="${key}"]`)
      ?.getAttribute("content");
  const title = plain(
    structuredArticle?.headline ||
      meta("og:title") ||
      document.querySelector("h1")?.textContent ||
      document.title,
  );
  const explicitDate =
    structuredArticle?.datePublished ||
    meta("article:published_time") ||
    meta("datePublished") ||
    meta("pubdate");
  // A news index can contain many dated cards; their dates do not date the index itself.
  const articlePath = isArticleUrl(url);
  const dateRaw =
    explicitDate ||
    (articlePath &&
      document
        .querySelector("article time[datetime],main time[datetime]")
        ?.getAttribute("datetime"));
  const feeds = [...document.querySelectorAll('link[rel="alternate"]')]
    .filter((n) => /rss|atom/.test(n.getAttribute("type") ?? ""))
    .map((n) => publicUrl(new URL(n.getAttribute("href"), url).href))
    .filter(Boolean);
  for (const e of document.querySelectorAll(
    "script,style,nav,footer,header,noscript,svg,form",
  ))
    e.remove();
  const main =
    document.querySelector('main,article,[role="main"]') ?? document.body;
  const text = plain(main?.textContent, 18000);
  const description = plain(meta("description") || meta("og:description"), 240);
  const paragraph =
    [...(main?.querySelectorAll("p") ?? [])]
      .map((p) => plain(p.textContent, 240))
      .find(
        (t) =>
          t.length >= 60 &&
          !/cookie|subscribe to|privacy policy|隐私政策|订阅邮件/i.test(t),
      ) ?? "";
  const links = [];
  for (const a of document.querySelectorAll("a[href]")) {
    let href;
    try {
      href = publicUrl(new URL(a.getAttribute("href"), url).href);
    } catch {
      continue;
    }
    if (!href) continue;
    const label = plain(a.textContent, 220);
    if (skipLink.test(href + " " + label)) continue;
    const container = a.closest("article,li") ?? a.parentElement;
    const dateText =
      dateInText(plain(a.textContent, 500)) ??
      dateInText(plain(container?.textContent, 500));
    const dt =
      container?.querySelector("time")?.getAttribute("datetime") || dateText;
    if (newsPath.test(href + " " + label))
      links.push({ url: href, title: label, publishedAt: isoDate(dt, now) });
  }
  const contentDate =
    dateRaw || (articlePath && dateInText(text.slice(0, 600)));
  return {
    title,
    description,
    excerpt: paragraph || (description.length >= 40 ? description : ""),
    text,
    fingerprint: hash(text.replace(/\d{1,2}:\d{2}(:\d{2})?/g, "")),
    publishedAt: isoDate(contentDate, now),
    links: [...new Map(links.map((l) => [l.url, l])).values()],
    feeds,
    article: Boolean(
      structuredArticle || explicitDate || (articlePath && contentDate),
    ),
  };
}

/** Public documentation commonly exposes Markdown; never execute or render it as HTML. */
function parseMarkdown(markdown, url, now) {
  const content = markdown.replace(/```[\s\S]*?```/g, "");
  const title = plain(content.match(/^#\s+(.+)$/m)?.[1] ?? "");
  const text = plain(
    content.replace(/!?(\[([^\]]*)\])\([^)]*\)/g, "$2"),
    18000,
  );
  const links = [];
  for (const m of content.matchAll(
    /\[([^\]]+)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g,
  )) {
    let link;
    try {
      link = publicUrl(new URL(m[2], url).href);
    } catch {
      continue;
    }
    if (link && newsPath.test(link + " " + m[1]) && !skipLink.test(link))
      links.push({ url: link, title: plain(m[1], 220), publishedAt: null });
  }
  const dateRaw = content.match(
    /^(?:datePublished|published|date):\s*["']?([^\r\n"']+)/im,
  )?.[1];
  return {
    title,
    text,
    description: "",
    excerpt: "",
    fingerprint: hash(text),
    publishedAt: isoDate(dateRaw, now),
    links,
    feeds: [],
    article: Boolean(dateRaw),
  };
}

export function classify(title, { kind: sourceKind } = {}) {
  const t = plain(title).toLowerCase();
  let kind = "other",
    stage = "reported";
  const productListing =
    /上市/.test(t) &&
    /售价|起售|万元起|万起|搭载|座舱|车型|新车|眼镜|手机|耳机|新品/.test(t) &&
    !/融资|募资|收购|\bipo\b|港股|科创板|创业板|纳斯达克|纽交所/.test(t);
  if (productListing)
    kind = /合作|交付|量产|订单/.test(t) ? "partnership" : "product";
  else if (
    /融资|募资|并购|收购|贷款|资助|\bipo\b|(?:赴|递表|申请|筹备|推进|寻求|完成|成功|正式|港股|科创板|创业板|纳斯达克|纽交所).{0,8}上市|funding|raises?\b|raised\b|series [a-f]|acqui[rs]|financing|investment round|secures? capital|(?:nasdaq|nyse) (?:debut|listing)|\bloan\b|\bgrant\b/.test(
      t,
    )
  )
    kind = "funding";
  else if (
    /榜单|上榜|入选|获奖|奖项|排名|入围|获评|award|rank|benchmark|leaderboard|finalist|\btop \d+/.test(
      t,
    )
  )
    kind = "ranking";
  else if (
    /合作|伙伴|携手|订单|交付|签约|量产|批量生产|投产|扩产|partner|collaborat|purchase order|delivery|production|expands? (?:\w+ ){0,3}(?:service|operations|presence)|commercial deployment/.test(
      t,
    )
  )
    kind = "partnership";
  else if (
    /任命|离职|裁员|新设|成立.{0,15}公司|设立.{0,15}子公司|营收|净利润|appoint|layoff|new subsidiary|quarterly revenue|revenue (?:rises|grows)|opens?.{0,20}(?:office|factory)/.test(
      t,
    )
  )
    kind = "people";
  else if (
    /发布|推出|新品|开源|(?:车型|汽车|手机|眼镜|机器人|新品).{0,8}上市|\bdemo\b|pre.?order|\blaunch(?:es|ed)?\b|introduc|release(?:d|s)?\b|general availability|now available|unveil|\bdebut\b|\bv\d+\./.test(
      t,
    ) ||
    sourceKind === "release"
  )
    kind = "product";
  else if (/任命|离职|加入|裁员|ceo|appoint|joins|layoff|founder|董事/.test(t))
    kind = "people";
  else if (/研究|论文|research|paper|arxiv/.test(t)) kind = "research";
  if (kind === "funding")
    stage =
      /(?:拟|计划|洽谈|传闻|寻求).{0,20}(?:融资|募资|收购|上市|贷款)|(?:seeking|in talks|plans?|rumou?r).{0,60}(?:rais|funding|acqui|ipo|loan)/.test(
        t,
      )
        ? "planned"
        : /conditional|附条件|有条件/.test(t)
          ? "conditional"
          : /完成|获得|获投|获.*融资|raises?\b|raised|closes?\b|secured/.test(t)
            ? "announced"
            : "reported";
  if (kind === "product")
    stage =
      sourceKind === "release"
        ? "software-release"
        : /预售|pre.?order/.test(t)
          ? "preorder"
          : /演示|demo|preview|预览/.test(t)
            ? "demo"
            : /上线|可用|available|general availability|正式发布|正式上市/.test(
                  t,
                )
              ? "available"
              : /(?:计划|拟|将).{0,20}(?:发布|推出)|\bto (?:launch|unveil|release)\b/.test(
                    t,
                  )
                ? "planned"
                : "announced";
  if (kind === "ranking")
    stage = /入围|候选|finalist|shortlist|nominat/.test(t)
      ? "shortlisted"
      : /获奖|荣获|won\b|winner|wins\b/.test(t)
        ? "awarded"
        : /榜单|上榜|rank|list|入选|top \d+/.test(t)
          ? "listed"
          : "reported";
  if (kind === "partnership")
    stage =
      /(?:计划|拟|有望|预计|将于|明年).{0,30}(?:量产|生产|投产|交付|合作)|(?:plans?|expects?|will).{0,40}(?:produc|deliver|deploy|partner)/.test(
        t,
      )
        ? "planned"
        : /交付|量产|订单|批量生产|投产|delivered|production|purchase order/.test(
              t,
            )
          ? "delivery"
          : /试点|pilot|trial/.test(t)
            ? "pilot"
            : "cooperation";
  const round =
    t
      .match(
        /(?:pre[- ]?)?[a-f](?:\d)?\+?\s*轮|天使轮|种子轮|series\s+[a-f]\d?|seed round|pre[- ]seed/i,
      )?.[0]
      ?.replace(/\s+/g, "")
      .toLowerCase() ?? null;
  const money = [
    ...title.matchAll(
      /(?:US\$|\$|USD|RMB|人民币|美元|€)\s*[\d,.]+\s*(?:million|billion|bn\b|[mb]\b|亿|万)?|[\d,.]+\s*(?:亿|万)(?:美元|元|人民币)/gi,
    ),
  ];
  const amount =
    kind === "funding"
      ? (money.find((m) => {
          const before = title.slice(Math.max(0, m.index - 30), m.index);
          const after = title.slice(
            m.index + m[0].length,
            m.index + m[0].length + 20,
          );
          return (
            !/(?:估值|市值|注册资本|营收|valuation|valued at|revenue|market cap)(?:约|超|超过|达|达到|为| of)?\s*$/i.test(
              before,
            ) &&
            !/^\s*(?:的)?(?:估值|市值|valuation|revenue|(?:robot )?orders?\b|(?:Nasdaq|NYSE) (?:debut|listing))/i.test(
              after,
            )
          );
        })?.[0] ?? null)
      : null;
  const financingType =
    kind !== "funding"
      ? null
      : /贷款|\bloan\b/.test(t)
        ? "loan"
        : /资助|补助|\bgrant\b/.test(t)
          ? "grant"
          : /并购|收购|acqui[rs]/.test(t)
            ? "acquisition"
            : /上市|\bipo\b|(?:nasdaq|nyse) (?:debut|listing)/.test(t)
              ? "ipo"
              : "funding";
  return {
    kind,
    stage,
    round: kind === "funding" ? round : null,
    amount,
    financingType,
  };
}
function normalized(t) {
  return t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}
function grams(t) {
  const s = normalized(t);
  return new Set(
    Array.from({ length: Math.max(0, s.length - 1) }, (_, i) =>
      s.slice(i, i + 2),
    ),
  );
}
export function similar(a, b) {
  const x = grams(a),
    y = grams(b);
  const intersection = [...x].filter((v) => y.has(v)).length;
  return intersection / Math.max(1, x.size + y.size - intersection);
}
export function sameEvent(a, b) {
  if (
    a.companyId !== b.companyId ||
    a.kind !== b.kind ||
    a.stage !== b.stage ||
    a.role !== b.role ||
    (a.kind === "funding" &&
      (a.financingType ?? "funding") !== (b.financingType ?? "funding"))
  )
    return false;
  if (
    a.sources.some((x) =>
      b.sources.some((y) => canonical(x.url) === canonical(y.url)),
    )
  )
    return true;
  if (
    !a.publishedAt ||
    !b.publishedAt ||
    Math.abs(Date.parse(a.publishedAt) - Date.parse(b.publishedAt)) >
      7 * 86400000
  )
    return false;
  if (
    a.round !== b.round ||
    (a.amount && b.amount && normalized(a.amount) !== normalized(b.amount))
  )
    return false;
  const versions = (t) =>
    t.match(/\b(?:v)?\d+(?:\.\d+){1,3}(?:[a-z]+)?\b/gi)?.join("|") ?? "";
  if (versions(a.title) !== versions(b.title)) return false;
  if (
    a.kind === "funding" &&
    a.round &&
    a.amount &&
    b.amount &&
    normalized(a.amount) === normalized(b.amount)
  )
    return true;
  return similar(a.title, b.title) >= 0.72;
}
export function eventClassification(title, source, company) {
  const matched = matchCompanies(
    { title, summary: "" },
    compileAliases([company]),
  );
  let role =
    source.kind !== "search" || matched.length ? "subject" : "search-match";
  const classification =
    role === "search-match"
      ? { kind: "other", stage: "reported", round: null, amount: null }
      : classify(title, source);
  if (
    source.kind === "search" &&
    /股价|涨停|跌停|\d+连板|盘中.{0,8}涨|盘中.{0,8}跌|低点反弹|股票评级|目标价|融资融券|融资(?:净买入|净卖出|余额|买入|偿还)|融券(?:余额|卖出)|主力资金|资金净流[入出]|资金净[买卖]|重仓股|龙虎榜|收盘[涨跌]|开盘[涨跌]|股(?:票)?涨|上市涨幅|沽空|解盘|\betf\b|price target|stock price|stocks? (?:rises?|falls?|surges?|jumps?|gains?|tumbles?|slumps?|rall(?:y|ies)|sinks?|trade[s]? (?:up|down))|shares (?:rise|fall)|earnings preview|analyst rating|holds? \$\d+.{0,40}target/i.test(
      title,
    )
  ) {
    role = "market-context";
    classification.kind = "other";
    classification.stage = "reported";
    classification.round = null;
    classification.amount = null;
    classification.financingType = null;
  }
  // Surnames and unrelated divisions share SCHUNK. A bare name is insufficient evidence.
  if (
    source.kind === "search" &&
    company.id === "schunk" &&
    !/雄克|gripp|robot|automat|clamp|end.?effector|cobot|machin|toolhold|夹持|机械手|自动化|夹爪/i.test(
      title,
    )
  ) {
    role = "search-match";
    classification.kind = "other";
    classification.stage = "reported";
  }
  // Robotiq.ai is the Croatian RPA software company, not the gripper manufacturer.
  // Identity evidence: https://www.hcltech.com/de-de/press-releases/hclsoftware-acquire-robotiqai-strengthening-enterprise-agentic-automation
  if (
    source.kind === "search" &&
    company.id === "robotiq" &&
    /\brobotiq\.ai\b/i.test(title)
  ) {
    role = "search-match";
    Object.assign(classification, {
      kind: "other",
      stage: "reported",
      round: null,
      amount: null,
      financingType: null,
    });
  }
  if (role === "subject" && classification.kind === "funding") {
    const alias = matched[0]?.alias;
    if (alias) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const investor = new RegExp(
        `${escaped}\\s*(?:(?:宣布|联合|战略|再次)\\s*)?(?:领投|跟投|入股|参投|投资于|invests? in|backs?\\b)|${escaped}[-–]backed\\b|(?:led by|backed by|investors? include)\\s+${escaped}`,
        "i",
      );
      if (investor.test(title)) {
        role = "investor";
      } else if (source.kind === "search") {
        const ipoOwner = title.match(
          /\b([A-Z][A-Za-z0-9.-]*(?:\s+[A-Z][A-Za-z0-9.-]*){0,2})['’]s\s+IPO\b/,
        )?.[1];
        if (
          ipoOwner &&
          !company.match.some((a) => normalized(a) === normalized(ipoOwner))
        )
          role = "mentioned";
      }
    }
  }
  return { ...classification, role };
}
export function mergeEvents(previous, incoming, now) {
  const events = previous.map((e) => structuredClone(e));
  for (const e of incoming) {
    const old = events.find((o) => o.id === e.id || sameEvent(o, e));
    if (!old) {
      events.push(e);
      continue;
    }
    const fresh = e.sources.filter(
      (s) => !old.sources.some((v) => canonical(v.url) === canonical(s.url)),
    );
    let changed = fresh.length > 0;
    if (fresh.length) old.sources.push(...fresh);
    for (const source of e.sources) {
      const previous = old.sources.find((s) => s.url === source.url);
      if (
        previous &&
        source.contentHash &&
        previous.contentHash !== source.contentHash
      ) {
        previous.contentHash = source.contentHash;
        changed = true;
      }
    }
    if (old.id === e.id) {
      for (const key of [
        "title",
        "kind",
        "stage",
        "role",
        "round",
        "amount",
        "publishedAt",
        "financingType",
      ])
        if ((old[key] ?? null) !== (e[key] ?? null)) {
          old[key] = e[key];
          changed = true;
        }
    }
    if (
      e.summary &&
      (!old.summary || old.id === e.id) &&
      old.summary !== e.summary
    ) {
      old.summary = e.summary;
      old.summaryType = e.summaryType;
      changed = true;
    }
    if (changed) {
      old.updatedAt = now;
      old.revision += 1;
    }
  }
  return retainEvents(
    events.filter(
      (e) =>
        Date.parse(e.publishedAt ?? e.discoveredAt) >=
        Date.parse(now) - 365 * 86400000,
    ),
  );
}
export function retainEvents(events, limit = 5000) {
  const recent = (a, b) =>
    (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "") ||
    a.id.localeCompare(b.id);
  const quality = (e) =>
    !["subject", "investor", "partner"].includes(e.role)
      ? 0
      : e.kind === "other"
        ? 1
        : 2;
  const ranked = [...events].sort(
    (a, b) => quality(b) - quality(a) || recent(a, b),
  );
  if (events.length <= limit) return ranked.sort(recent);
  const companies = new Set(events.map((e) => e.companyId));
  const floor = Math.max(1, Math.min(10, Math.floor(limit / companies.size)));
  const picked = [],
    ids = new Set(),
    counts = new Map();
  // Reserve one dated first-party record within each company's history allowance.
  // A busy news index must not crowd out the company's own announcement.
  const firstParty = new Map();
  for (const e of [...events].sort(recent))
    if (
      e.evidence === "official" &&
      e.publishedAt &&
      quality(e) > 0 &&
      !firstParty.has(e.companyId)
    )
      firstParty.set(e.companyId, e.id);
  const companyHistory = [...ranked].sort(
    (a, b) =>
      Number(firstParty.get(b.companyId) === b.id) -
      Number(firstParty.get(a.companyId) === a.id),
  );
  for (const e of companyHistory)
    if ((counts.get(e.companyId) ?? 0) < floor) {
      picked.push(e);
      ids.add(e.id);
      counts.set(e.companyId, (counts.get(e.companyId) ?? 0) + 1);
      if (picked.length === limit) break;
    }
  for (const e of ranked)
    if (picked.length < limit && !ids.has(e.id)) {
      picked.push(e);
      ids.add(e.id);
    }
  return picked.sort(recent);
}
export function makeEvent(
  row,
  source,
  company,
  now,
  { baseline = false } = {},
) {
  const title = plain(
    source.kind === "search"
      ? row.title.replace(/\s+-\s+[^-]+$/, "")
      : row.title,
  );
  const official = source.kind !== "search";
  const classification = eventClassification(title, source, company);
  return {
    id: hash(company.id + "|" + row.url),
    companyId: company.id,
    title:
      source.kind === "release"
        ? `${company.name} · ${source.product ?? "开发工具"} ${title}`
        : title,
    ...classification,
    evidence: official ? "official" : "discovery",
    publishedAt: row.publishedAt ?? null,
    occurredAt: null,
    discoveredAt: now,
    updatedAt: now,
    revision: 1,
    baseline,
    summary: official && row.excerpt ? plain(row.excerpt, 240) : "",
    summaryType: official && row.excerpt ? "source-excerpt" : "title-only",
    sources: [
      {
        id: source.id,
        name: row.publisher || source.name,
        url: row.url,
        publishedAt: row.publishedAt ?? null,
        material: row.material ?? "official-page",
        checkedAt: now,
      },
    ],
  };
}
export function sourceState(previous, result, now) {
  if (result.error)
    return {
      ...previous,
      lastAttemptAt: now,
      status: "error",
      error: result.error,
      consecutiveFailures: (previous?.consecutiveFailures ?? 0) + 1,
    };
  return {
    ...previous,
    lastAttemptAt: now,
    lastSuccessAt: now,
    status: result.newCount ? "new" : "ok",
    error: null,
    consecutiveFailures: 0,
    count: result.count,
    newCount: result.newCount ?? 0,
    fingerprint: result.fingerprint ?? previous?.fingerprint,
    pageUrl: result.pageUrl ?? previous?.pageUrl,
  };
}

/** Check once in each UTC interval, even when the previous run finished late. */
export function sourceDue(lastAttemptAt, intervalHours, now = Date.now()) {
  const last = Date.parse(lastAttemptAt ?? "");
  if (!Number.isFinite(last)) return true;
  const interval = Math.max(1, Number(intervalHours) || 1) * 3600000;
  return Math.floor(now / interval) > Math.floor(last / interval);
}
