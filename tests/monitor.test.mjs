import test from "node:test";
import assert from "node:assert/strict";
import {
  parseFeed,
  parsePage,
  classify,
  sameEvent,
  mergeEvents,
  makeEvent,
  sourceState,
  sourceDue,
  isoDate,
  eventClassification,
  retainEvents,
  sourceExcerpt,
  isArticleUrl,
  pageIsReadable,
} from "../scripts/lib/monitor-core.mjs";
import zlib from "node:zlib";
import {
  decodeBody,
  publicAddress,
  publicUrl,
  robotsAllowed,
} from "../scripts/lib/monitor-fetch.mjs";
const now = "2026-10-26T03:00:00Z";
const company = {
  id: "wuji",
  name: "舞肌科技",
  match: ["舞肌科技", "Wuji Technology", "舞肌"],
};
const source = { id: "wuji:test", kind: "search", name: "检索" };
const make = (
  title,
  url = "https://example.com/news/a",
  date = "2026-10-20T00:00:00Z",
) => makeEvent({ title, url, publishedAt: date }, source, company, now);
test("public fetch rejects loopback, private, mapped and reserved destinations", () => {
  for (const ip of [
    "127.0.0.1",
    "169.254.169.254",
    "10.1.1.2",
    "172.16.2.3",
    "192.168.1.1",
    "198.18.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "2001:db8::1",
  ])
    assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress("1.1.1.1"), true);
  assert.equal(publicAddress("2606:4700::1111"), true);
  for (const url of [
    "file:///etc/passwd",
    "http://127.0.0.1/a",
    "https://user:secret@example.com",
    "https://example.com:22/a",
  ])
    assert.equal(publicUrl(url), null);
});
test("RSS and Atom preserve publisher dates and reject XML entities", () => {
  const xml =
    "<rss><channel><item><title>舞肌科技完成A轮融资</title><link>https://example.com/a</link><pubDate>Tue, 20 Oct 2026 10:00:00 GMT</pubDate><source>媒体甲</source></item></channel></rss>";
  assert.equal(parseFeed(xml, source, now)[0].publisher, "媒体甲");
  assert.equal(
    parseFeed(
      '<feed><entry><title>v1.2.0</title><link href="https://github.com/example/repo/releases/1"/><updated>2026-10-20T00:00:00Z</updated></entry></feed>',
      source,
      now,
    ).length,
    1,
  );
  assert.throws(() =>
    parseFeed(
      '<!DOCTYPE rss [<!ENTITY e SYSTEM "file:///etc/passwd">]><rss/>',
      source,
      now,
    ),
  );
  assert.equal(parseFeed("<rss><channel/></rss>", source, now).length, 0);
});
test("undated product pages are baseline checks, not dated launches", () => {
  const page = parsePage(
    "<html><head><title>Wuji Hand 2</title></head><body><main><h1>Wuji Hand 2</h1><p>20 DOF</p></main></body></html>",
    "https://www.wuji.tech/zh/hand2",
    now,
  );
  assert.equal(page.publishedAt, null);
  assert.equal(page.article, false);
  assert.equal(isoDate("2030-01-01", now), null);
});
test("structured article publication and main content survive HTML extraction", () => {
  const p = parsePage(
    '<html><head><script type="application/ld+json">{"@type":"NewsArticle","headline":"产品正式发布","datePublished":"2026-10-20"}</script></head><body><nav>登录</nav><main>正式发布产品</main></body></html>',
    "https://example.com/news/x",
    now,
  );
  assert.equal(p.title, "产品正式发布");
  assert.equal(p.publishedAt, "2026-10-20T00:00:00.000Z");
  assert.equal(p.text.includes("登录"), false);
});
test("financing plans, product demo and awards retain distinct stages", () => {
  assert.equal(classify("舞肌科技拟完成A轮融资").stage, "planned");
  assert.equal(classify("舞肌科技完成A轮融资").stage, "announced");
  assert.equal(classify("Wuji Hand 2 product demo").stage, "demo");
  assert.equal(classify("舞肌科技入围年度机器人奖项").stage, "shortlisted");
  assert.equal(classify("舞肌科技荣获年度机器人奖项").stage, "awarded");
});
test("same round/amount in different reports consolidates while later rounds stay distinct", () => {
  const a = make("舞肌科技完成1亿元A轮融资"),
    b = make("融资消息：舞肌科技获1亿元A轮融资", "https://media.example.com/b");
  assert.equal(sameEvent(a, b), true);
  assert.equal(
    sameEvent(a, make("舞肌科技完成1亿元B轮融资", "https://example.com/b")),
    false,
  );
  assert.equal(
    sameEvent(a, make("舞肌科技完成2亿元A轮融资", "https://example.com/c")),
    false,
  );
  const merged = mergeEvents([a], [b], now);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].sources.length, 2);
  assert.equal(merged[0].id, a.id);
  assert.equal(mergeEvents(merged, [b], now)[0].revision, 2);
});
test("separate software releases never collapse by otherwise similar title", () => {
  assert.equal(
    sameEvent(
      make("舞肌科技 SDK v1.2.0发布"),
      make("舞肌科技 SDK v1.3.0发布", "https://example.com/b"),
    ),
    false,
  );
});
test("search-only association is a lead; title does not become a verified fact", () => {
  const e = make("机器人行业融资增长");
  assert.equal(e.role, "search-match");
  assert.equal(e.kind, "other");
  assert.equal(e.evidence, "discovery");
  assert.equal(e.summary, "");
  const official = makeEvent(
    {
      title: "SDK v1.2.0",
      url: "https://github.com/wuji-technology/wuji-sdk/releases/1",
      publishedAt: now,
    },
    { id: "wuji:sdk", kind: "release", name: "官方", product: "SDK" },
    company,
    now,
  );
  assert.equal(official.role, "subject");
  assert.equal(official.evidence, "official");
  assert.equal(official.stage, "software-release");
});
test("source failure preserves successful check time and never looks like no updates", () => {
  const good = sourceState(null, { count: 4, newCount: 0 }, now);
  const bad = sourceState(good, { error: "timeout" }, "2026-10-26T04:00:00Z");
  assert.equal(bad.status, "error");
  assert.equal(bad.lastSuccessAt, now);
  assert.equal(bad.lastAttemptAt, "2026-10-26T04:00:00Z");
  assert.equal(bad.count, 4);
});

test("hourly scheduling does not skip an hour because a fetch finished after minute 17", () => {
  assert.equal(
    sourceDue("2026-10-28T05:26:36Z", 1, Date.parse("2026-10-28T06:17:20Z")),
    true,
  );
  assert.equal(
    sourceDue("2026-10-28T05:26:36Z", 1, Date.parse("2026-10-28T05:45:20Z")),
    false,
  );
  assert.equal(
    sourceDue("2026-10-28T00:20:00Z", 6, Date.parse("2026-10-28T06:17:20Z")),
    true,
  );
  assert.equal(
    sourceDue("2026-10-28T00:20:00Z", 6, Date.parse("2026-10-28T05:17:20Z")),
    false,
  );
  assert.equal(sourceDue(null, 6, Date.parse("2026-10-28T05:17:20Z")), true);
});
test("robots honors specific and longest allow/disallow rules", () => {
  assert.equal(
    robotsAllowed(
      "User-agent: *\nDisallow: /private\nAllow: /private/news",
      "https://example.com/private/news",
    ),
    true,
  );
  assert.equal(
    robotsAllowed(
      "User-agent: *\nDisallow: /private",
      "https://example.com/private/x",
    ),
    false,
  );
  assert.equal(
    robotsAllowed(
      "User-agent: FinMapMonitor\nDisallow: /\nUser-agent: *\nAllow: /",
      "https://example.com/news",
    ),
    false,
  );
});
test("investment participation and stock-price commentary do not masquerade as own fundraising", () => {
  assert.equal(
    eventClassification("舞肌科技领投机器人企业A轮融资", source, company).role,
    "investor",
  );
  assert.equal(
    eventClassification(
      "Positron AI Funding Backs a Memory-First Challenge to Nvidia",
      source,
      { id: "positron", name: "Positron", match: ["Positron", "Positron AI"] },
    ).role,
    "subject",
  );
  assert.equal(
    eventClassification(
      "前Momenta算法高级总监创业，简智机器人完成A轮融资、“老东家”领投",
      source,
      { id: "genrobot", name: "简智机器人", match: ["简智机器人"] },
    ).role,
    "subject",
  );
  assert.equal(
    eventClassification(
      "北京具身数据创企简智机器人完成A轮融资，Momenta领投",
      source,
      { id: "momenta", name: "Momenta", match: ["Momenta"] },
    ).role,
    "investor",
  );
  const c = { id: "nvidia", name: "英伟达", match: ["英伟达", "NVIDIA"] };
  assert.equal(
    eventClassification(
      "NVIDIA stock price target rises after AI demand",
      source,
      c,
    ).role,
    "market-context",
  );
});
test("market microstructure and product listings do not become venture financing", () => {
  const vehicle = classify(
    "11.98万起 家越07正式上市 搭载Momenta R7世界模型+豆包座舱助手",
  );
  assert.equal(vehicle.kind, "product");
  assert.equal(vehicle.amount, null);
  assert.equal(vehicle.financingType, null);
  for (const title of [
    "舞肌科技：融资净买入4179万元，融资余额11亿元",
    "机器人ETF重仓股舞肌科技涨0.35%",
    "舞肌科技主力资金净流出5000万元",
  ]) {
    const e = eventClassification(title, source, company);
    assert.equal(e.role, "market-context", title);
    assert.equal(e.kind, "other", title);
  }
  assert.equal(
    classify("九款合作车型上市，机器人产品正式交付").kind,
    "partnership",
  );
  assert.equal(classify("XREAL 新款眼镜上市").kind, "product");
  assert.equal(classify("某机器人公司科创板上市申请获受理").kind, "funding");
  assert.equal(classify("某公司完成2亿元B轮融资").kind, "funding");
});
test("SCHUNK tennis-player surname is not a robotics-company event", () => {
  const c = { id: "schunk", name: "雄克", match: ["雄克", "SCHUNK"] };
  assert.equal(
    eventClassification("Schunk vs Jorge Prediction Market", source, c).role,
    "search-match",
  );
  assert.equal(
    eventClassification("SCHUNK unveils new robotic gripper", source, c).role,
    "subject",
  );
});

test("Robotiq.ai RPA acquisition is not the Robotiq gripper manufacturer's acquisition", () => {
  const c = { id: "robotiq", name: "Robotiq", match: ["Robotiq"] };
  assert.equal(
    eventClassification(
      "HCLTech completes Robotiq.ai acquisition to add RPA to UnO Agentic",
      source,
      c,
    ).role,
    "search-match",
  );
  assert.equal(
    eventClassification("Robotiq unveils AI-powered gripper", source, c).role,
    "subject",
  );
});
test("undated baseline records cannot rise above dated company news on a fresh run", () => {
  const known = make(
    "舞肌科技发布SDK",
    "https://example.com/known",
    "2026-10-20T00:00:00Z",
  );
  const unknown = {
    ...make("历史产品资料"),
    id: "unknown",
    publishedAt: null,
    baseline: true,
    discoveredAt: now,
  };
  assert.equal(retainEvents([unknown, known])[0].id, known.id);
});
test("busy companies cannot evict a quiet company from bounded retention", () => {
  const busy = Array.from({ length: 40 }, (_, i) => ({
    ...make("舞肌科技发布产品" + i, "https://example.com/" + i),
    companyId: "busy",
    id: "busy" + i,
  }));
  const quiet = {
    ...make(
      "小公司完成A轮融资",
      "https://example.com/quiet",
      "2026-08-01T00:00:00Z",
    ),
    companyId: "quiet",
    id: "quiet",
  };
  const kept = retainEvents([...busy, quiet], 20);
  assert.equal(kept.length, 20);
  assert.ok(kept.some((e) => e.id === "quiet"));
});

test("a company's older first-party article survives a busy news index", () => {
  const recent = Array.from({ length: 30 }, (_, i) => ({
    ...make("舞肌科技发布产品" + i, "https://example.com/" + i),
    id: "busy-" + i,
  }));
  const official = {
    ...make(
      "舞肌科技展会动态",
      "https://example.com/official",
      "2026-08-01T00:00:00Z",
    ),
    id: "first-party",
    kind: "other",
    evidence: "official",
  };
  const kept = retainEvents([...recent, official], 20);
  assert.equal(kept.length, 20);
  assert.ok(kept.some((e) => e.id === official.id));
});
test("a corrected article keeps its stable ID and becomes unread exactly once", () => {
  const original = make("舞肌科技拟完成A轮融资");
  const corrected = make("舞肌科技完成A轮融资");
  const result = mergeEvents([original], [corrected], now);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, original.id);
  assert.equal(result[0].stage, "announced");
  assert.equal(result[0].revision, 2);
  assert.equal(mergeEvents(result, [corrected], now)[0].revision, 2);
});

test("Markdown documentation and HTML fragments are readable without inventing a release date", () => {
  const page = parsePage(
    "# Cohere platform\n\nPublic model documentation for developers.\n[Release notes](https://docs.cohere.com/docs/release-notes)",
    "https://docs.cohere.com/docs/platform.md",
    now,
  );
  assert.equal(page.title, "Cohere platform");
  assert.equal(page.publishedAt, null);
  assert.equal(page.article, false);
  assert.equal(page.links.length, 1);
  assert.equal(
    parsePage(
      "<h1>Documentation</h1><p>Public reference</p>",
      "https://example.com/docs",
      now,
    ).title,
    "Documentation",
  );
});

test("dated cards on a news index do not make the index a newly published article", () => {
  const page = parsePage(
    '<main><h1>News Center</h1><article><time datetime="2026-10-20"></time><a href="/news-and-media/news-center/robot-release/">New robot release</a></article></main>',
    "https://example.com/news-and-media/news-center/",
    now,
  );
  assert.equal(page.article, false);
  assert.equal(page.publishedAt, null);
  assert.equal(page.links[0].publishedAt, "2026-10-20T00:00:00.000Z");
});

test("English article datelines and index card dates work independently of server timezone", () => {
  const a = parsePage(
    "<main><h1>Funding announcement</h1><p>San Francisco, CA, August 17, 2026 — Company today announced its funding.</p></main>",
    "https://example.com/newsroom/funding",
    now,
  );
  assert.equal(a.publishedAt, "2026-08-17T00:00:00.000Z");
  assert.equal(a.article, true);
  assert.equal(isoDate("SEPTEMBER 17, 2026", now), "2026-09-17T00:00:00.000Z");
  assert.equal(isoDate("17 Sep 2026", now), "2026-09-17T00:00:00.000Z");
  const hub = parsePage(
    '<main><h1>Blog</h1><a href="/blog/preview">Model in limited previewOctober 15, 2026</a><a href="/news-import/quantum-update">Read More</a></main>',
    "https://example.com/blog",
    now,
  );
  assert.equal(hub.links[0].publishedAt, "2026-10-15T00:00:00.000Z");
  assert.equal(hub.publishedAt, null);
  assert.equal(isArticleUrl(hub.links[1].url), true);
  assert.equal(
    isArticleUrl("https://example.com/news-and-media/news-center/"),
    false,
  );
  assert.equal(pageIsReadable({ title: "", text: "x".repeat(1000) }), false);
  assert.equal(
    pageIsReadable({ title: "Just a moment", text: "x".repeat(1000) }),
    false,
  );
});

test("short official excerpts are plain text and never manufactured from a search snippet", () => {
  const paragraph =
    "This article introduces a new model preview with expanded support for developer workflows.";
  const page = parsePage(
    `<html><head><meta name="description" content="The company is the global leader in AI products and enterprise infrastructure."></head><body><main><h1>New model preview</h1><p>${paragraph}</p></main></body></html>`,
    "https://example.com/blog/new-model",
    now,
  );
  assert.equal(page.excerpt, paragraph);
  const xml =
    "<rss><channel><item><title>SDK release</title><link>https://example.com/release</link><pubDate>2026-10-20</pubDate><description><![CDATA[<p>New firmware support.</p><script>secret()</script>]]></description></item></channel></rss>";
  const official = { ...source, kind: "feed" };
  const row = parseFeed(xml, official, now)[0];
  assert.equal(row.excerpt, "New firmware support.");
  assert.equal(
    makeEvent(row, official, company, now).summaryType,
    "source-excerpt",
  );
  assert.equal(parseFeed(xml, source, now)[0].excerpt, "");
  assert.equal(makeEvent(row, source, company, now).summary, "");
  assert.equal(sourceExcerpt("x".repeat(500)).length, 240);
  const old = makeEvent({ ...row, excerpt: "" }, official, company, now);
  const fresh = makeEvent(row, official, company, now);
  const merged = mergeEvents([old], [fresh], now);
  assert.equal(merged[0].summary, row.excerpt);
  assert.equal(merged[0].revision, 2);
  assert.equal(mergeEvents(merged, [fresh], now)[0].revision, 2);
});

test("financing facts separate valuation, loan conditions and company roles", () => {
  const fund = classify("Company raises $1B at a $20B valuation");
  assert.equal(fund.amount, "$1B");
  assert.equal(
    classify("Company in talks for funding at $20B valuation").amount,
    null,
  );
  assert.equal(classify("估值100亿元，某公司完成2亿元B轮融资").amount, "2亿元");
  const loan = classify("PsiQuantum receives conditional $150 million loan");
  assert.equal(loan.financingType, "loan");
  assert.equal(loan.stage, "conditional");
  assert.equal(
    classify("Company raises $50M, plans expansion next year").stage,
    "announced",
  );
  const c = { id: "nvidia", name: "NVIDIA", match: ["NVIDIA", "英伟达"] };
  assert.equal(
    eventClassification(
      "Nvidia's worst nightmare may be lurking inside Anthropic's IPO filing",
      source,
      c,
    ).role,
    "mentioned",
  );
  assert.equal(
    sameEvent(
      { ...make("舞肌科技完成1亿元A轮融资"), financingType: "loan" },
      make("舞肌科技完成1亿元A轮融资", "https://example.com/equity"),
    ),
    false,
  );
});

test("actual title forms distinguish business developments from market noise", () => {
  assert.equal(
    classify("Google DeepMind Genie 4 Released: Real-Time World Simulation")
      .kind,
    "product",
  );
  assert.equal(
    classify(
      "Announcing General Availability of OCI Compute with NVIDIA Vera CPUs",
    ).stage,
    "available",
  );
  const listing = classify(
    "Agility Robotics touts $300M robot order ahead of $2.5B Nasdaq debut",
  );
  assert.equal(listing.financingType, "ipo");
  assert.equal(listing.amount, null);
  assert.equal(
    classify("Flexiv to Unveil Next-Generation Adaptive Robots").stage,
    "planned",
  );
  assert.equal(
    classify("宁德时代新设储能科技公司，含AI相关业务").kind,
    "people",
  );
  assert.equal(classify("影石创新营收94亿元，同比增长43%").kind, "people");
  assert.equal(
    classify("Waymo expands service to new cities").kind,
    "partnership",
  );
  assert.equal(
    classify("宁德时代全固态电池明年有望小批量生产").stage,
    "planned",
  );
  assert.equal(classify("大模型产业概览").kind, "other");
  assert.equal(
    classify("Flexiv Secures Capital from Leading Evergreen Investor").kind,
    "funding",
  );
  for (const title of [
    "AMD stocks trade up on AI demand",
    "智谱沽空金额创新高",
    "【解盘】绿的谐波领衔，机器人上涨，国标+量产双催化",
  ]) {
    assert.equal(
      eventClassification(title, source, {
        id: "sample",
        name: "sample",
        match: ["AMD", "智谱", "绿的谐波"],
      }).role,
      "market-context",
      title,
    );
  }
});

test("gzipped HTTP responses and SPA metadata/form wrappers remain readable", () => {
  const html =
    "<html><head><title>汇川技术(INOVANCE)</title></head><body>" +
    "工业自动化控制与驱动技术解决方案供应商。".repeat(8) +
    "</body></html>";
  const gz = zlib.gzipSync(Buffer.from(html, "utf8"));
  assert.equal(decodeBody(gz, "gzip", 10000), html);
  assert.throws(() => decodeBody(gz, "gzip", 20), /response_too_large/);

  const whitespaceH1 = parsePage(
    `<html><head><title>沐曦MetaX | GPU企业</title></head><body><h1>   \n  </h1><div>${"高性能通用GPU芯片与算力解决方案。".repeat(10)}</div></body></html>`,
    "https://www.metax-tech.com/",
    now,
  );
  assert.equal(whitespaceH1.title, "沐曦MetaX | GPU企业");
  assert.equal(pageIsReadable(whitespaceH1), true);

  const tinyArticle = parsePage(
    `<html><head><title>企业介绍 - 速腾聚创</title></head><body><article>短卡片</article><div>${"数字化激光雷达与机器人感知核心部件量产平台。".repeat(8)}</div></body></html>`,
    "https://www.robosense.cn/about",
    now,
  );
  assert.equal(pageIsReadable(tinyArticle), true);

  const formWrapped = parsePage(
    `<html><head><title>Archer Aviation - Investor Relations</title></head><body><form id="form1"><p>${"Archer is designing and developing electric vertical takeoff and landing aircraft. ".repeat(3)}</p></form></body></html>`,
    "https://investors.archer.com/overview/default.aspx",
    now,
  );
  assert.equal(pageIsReadable(formWrapped), true);

  const spaMeta = parsePage(
    '<html><head><title>智谱丨BigModel 平台</title><meta name="description" content="智谱大模型开放平台是新一代国产自主通用AI大模型开放平台，研发了多款LLM模型与多模态视觉模型产品，致力于将认知智能技术与千行百业应用结合。"><meta name="keywords" content="大模型,LLM,多模态,智谱开放平台"></head><body><div id="app"></div></body></html>',
    "https://open.bigmodel.cn/",
    now,
  );
  assert.equal(spaMeta.title, "智谱丨BigModel 平台");
  assert.equal(pageIsReadable(spaMeta), true);

  const jsonLdOrg = parsePage(
    `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"JAKA Robotics","description":"${"JAKA Robotics is a global leader in collaborative robots and smart manufacturing solutions. ".repeat(2)}"}</script></head><body><div id="app"></div></body></html>`,
    "https://www.jaka.com/en",
    now,
  );
  assert.equal(jsonLdOrg.title, "JAKA Robotics");
  assert.equal(pageIsReadable(jsonLdOrg), true);
});
