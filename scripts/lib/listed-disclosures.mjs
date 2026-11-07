/**
 * Fetch high-signal statutory exchange disclosures (e.g., 投资者关系活动记录表,
 * periodic financial reports, buybacks, H-share IPO filings, major contracts)
 * and individual stock broker research reports (卖方个股研报) for listed hardtech
 * companies in FinMap via public EastMoney / CNINFO endpoints.
 */

export const LISTED_DISCLOSURE_TARGETS = [
  { companyId: 'orbbec', name: '奥比中光', code: '688322', market: 'A', board: '上交所科创板' },
  { companyId: 'cambricon', name: '寒武纪', code: '688256', market: 'A', board: '上交所科创板' },
  { companyId: 'moore-threads', name: '摩尔线程', code: '688795', market: 'A', board: '上交所科创板' },
  { companyId: 'metax', name: '沐曦股份', code: '688802', market: 'A', board: '上交所科创板' },
  { companyId: 'enflame', name: '燧原科技', code: '688801', market: 'A', board: '上交所科创板' },
  { companyId: 'unitree', name: '宇树科技', code: '688836', market: 'A', board: '上交所科创板' },
  { companyId: 'smic', name: '中芯国际', code: '688981', market: 'A', board: '上交所科创板' },
  { companyId: 'huahong-semi', name: '华虹公司', code: '688347', market: 'A', board: '上交所科创板' },
  { companyId: 'naura', name: '北方华创', code: '002371', market: 'A', board: '深交所主板' },
  { companyId: 'amec', name: '中微公司', code: '688012', market: 'A', board: '上交所科创板' },
  { companyId: 'acm-shanghai', name: '盛美上海', code: '688082', market: 'A', board: '上交所科创板' },
  { companyId: 'jcet', name: '长电科技', code: '600584', market: 'A', board: '上交所主板' },
  { companyId: 'empyrean', name: '华大九天', code: '301269', market: 'A', board: '深交所创业板' },
  { companyId: 'primarius', name: '概伦电子', code: '688206', market: 'A', board: '上交所科创板' },
  { companyId: 'leaderdrive', name: '绿的谐波', code: '688017', market: 'A', board: '上交所科创板' },
  { companyId: 'leadshine', name: '雷赛智能', code: '002979', market: 'A', board: '深交所主板' },
  { companyId: 'inovance', name: '汇川技术', code: '300124', market: 'A', board: '深交所创业板' },
  { companyId: 'insta360', name: '影石创新', code: '688775', market: 'A', board: '上交所科创板' },
  { companyId: 'catl', name: '宁德时代', code: '300750', market: 'A', board: '深交所创业板' },
  { companyId: 'eve-energy', name: '亿纬锂能', code: '300014', market: 'A', board: '深交所创业板' },
  { companyId: 'sungrow', name: '阳光电源', code: '300274', market: 'A', board: '深交所创业板' },
  { companyId: 'longi', name: '隆基绿能', code: '601012', market: 'A', board: '上交所主板' },
  { companyId: 'quantumctek', name: '国盾量子', code: '688027', market: 'A', board: '上交所科创板' },
  { companyId: 'ubtech', name: '优必选', code: '09880', market: 'H', board: '港交所' },
  { companyId: 'robosense', name: '速腾聚创', code: '02498', market: 'H', board: '港交所' },
  { companyId: 'dobot', name: '越疆', code: '02432', market: 'H', board: '港交所' },
  { companyId: 'biren', name: '壁仞科技', code: '06082', market: 'H', board: '港交所' },
  { companyId: 'iluvatar', name: '天数智芯', code: '09903', market: 'H', board: '港交所' },
  { companyId: 'hesai', name: '禾赛-W', code: '02525', market: 'H', board: '港交所' },
  { companyId: 'zhipu', name: '智谱', code: '02513', market: 'H', board: '港交所' },
  { companyId: 'minimax', name: 'MINIMAX-W', code: '00100', market: 'H', board: '港交所' },
  { companyId: 'mech-mind', name: '梅卡曼德', code: '09615', market: 'H', board: '港交所' },
  { companyId: 'seyond', name: '图达通', code: '02665', market: 'H', board: '港交所' },
  { companyId: 'lightelligence', name: '曦智科技', code: '01879', market: 'H', board: '港交所' },
  { companyId: 'direct-drive-tech', name: '本末科技', code: '06731', market: 'H', board: '港交所' },
  { companyId: 'momenta', name: 'Momenta', code: '06880', market: 'H', board: '港交所' },
];

const NOISE_TITLE_RE =
  /管理制度|决策制度|公司章程|议事规则|工作制度|工作细则|制度\(草案\)|政策\(草案\)|\(H股发行并上市后适用\)|法律意见书|律师事务所|核查意见|独立财务顾问|鉴证报告|持续督导|保荐代表人|会计师事务所|审计机构|会议决议|股东大会.*通知|股东会.*通知|会议资料|股东大会决议|股东会决议|独立董事.*(?:声明|承诺|意见|述职|制度)|激励对象名单|公示情况说明|内幕信息知情人|自查报告|等额置换|募集资金专户|现金管理|委托理财|弥补亏损|前十名.*股东|召开.*说明会的公告|参加.*说明会的公告|作废部分|翌日披露报表|月报表|董事会会议召开日期|致登记股东|致非登记股东|委任代表表格|海外监管公告|英文版|摘要$|变更公司注册资本|修订《公司章程》|工作报告|述职报告|内部控制评价报告|社会责任报告|环境、社会及管治|ESG/;

const HIGH_VALUE_TITLE_RE =
  /投资者关系活动记录表|年度报告|半年度报告|一季度报告|三季度报告|第一季度报告|第三季度报告|业绩快报|业绩预告|回购报告书|首次回购|回购.*进展|回购.*结果|股票激励计划\(草案\)|首次授予|归属条件成就|向特定对象发行.*结果|向特定对象发行.*预案|H股.*申请|境外上市.*申请|重大合同|日常经营重大合同|中标|战略合作|对外投资|收购|减持.*结果|增持|询价转让|聆讯后资料集|招股章程|正面盈利预告|盈利警告|全年业绩公告|中期业绩公告|季度业绩公告|自愿性?公告/;

function cleanWhitespace(raw) {
  return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
}

export function extractIrSummary(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';
  const compact = rawText.replace(/\r/g, '');
  let orgs = '';
  const orgBlock =
    compact.match(/(?:□其他|☑其他)\s*([\s\S]{10,1200}?)(?=\s*(?:时间|活动时间|地点|上市公司接待|公司接待))/) ||
    compact.match(/参与单位名称[\s\S]{0,40}?([^\n]+(?:\n[^\n]+){0,6}?)(?=\s*(?:时间|活动时间|地点|上市公司接待|公司接待))/);
  if (orgBlock) {
    orgs = cleanWhitespace(orgBlock[1].replace(/参与单位名称/g, '')).slice(0, 150);
  }
  const questions = [];
  const qRe = /(?:^|\n)\s*(?:问题\s*)?([1-9]\d?[\s、.．]|Q[1-9]\d?[\s：:.])([^\n]+(?:\n(?![\s]*(?:答[:：]|A[:：]|[1-9]\d?[\s、.．]))[^\n]+){0,2})/g;
  let m;
  while ((m = qRe.exec(compact)) !== null && questions.length < 4) {
    const qText = cleanWhitespace((m[1] + m[2]).replace(/主要内容/g, ''));
    if (qText.length >= 8 && !/附件清单|接待过程中/.test(qText)) {
      questions.push(qText.slice(0, 95));
    }
  }
  let answerHighlight = '';
  const firstAns = compact.match(/答[:：]\s*([\s\S]{30,360})/);
  if (firstAns) {
    answerHighlight = cleanWhitespace(firstAns[1].replace(/主要内容/g, '')).slice(0, 220);
  }
  const parts = [];
  if (orgs) parts.push(`参与机构：${orgs}`);
  if (questions.length) parts.push(`核心提问：${questions.join(' ')}`);
  if (answerHighlight) parts.push(`要点摘录：${answerHighlight}`);
  if (!parts.length) {
    return cleanWhitespace(compact).slice(0, 320);
  }
  return parts.join(' ｜ ').slice(0, 620);
}

export function classifyFiling(title, board) {
  if (/投资者关系活动记录表/.test(title)) {
    return {
      sourceName: `${board} · 机构调研纪要 (PDF)`,
      kind: 'research',
      stage: 'announced',
      summaryFallback: `${board}法定披露投资者关系活动记录表（机构调研问答纪要），点击可查看完整 PDF 原文。`,
    };
  }
  if (/年度报告|半年度报告|一季度报告|三季度报告|第一季度报告|第三季度报告|业绩快报|业绩预告|业绩公告|盈利预告|盈利警告/.test(title)) {
    return {
      sourceName: `${board} · 定期财报与业绩 (PDF)`,
      kind: 'people',
      stage: 'announced',
      summaryFallback: `${board}法定披露定期财务报告或业绩公告，点击可查阅完整财务报表与经营拆解 PDF。`,
    };
  }
  if (/H股|境外上市|招股章程|聆讯|向特定对象发行|回购|激励计划|首次授予|归属|减持|增持|询价转让/.test(title)) {
    return {
      sourceName: `${board} · 资本运作与激励公告 (PDF)`,
      kind: 'funding',
      stage: 'announced',
      summaryFallback: `${board}法定披露资本运作、股份回购或股权激励公告，点击可查阅 PDF 原文。`,
    };
  }
  return {
    sourceName: `${board} · 重大事项公告 (PDF)`,
    kind: 'partnership',
    stage: 'cooperation',
    summaryFallback: `${board}法定披露重大经营事项公告，点击可查阅 PDF 原文。`,
  };
}

export async function fetchCompanyDisclosures(target, { fetchImpl = fetch, maxDays = 180, now = new Date().toISOString() } = {}) {
  const cutoff = Date.parse(now) - maxDays * 86400000;
  const results = [];

  // 1. Statutory Announcements & Institutional Roadshow Records (投资者关系活动记录表)
  try {
    const annUrl = new URL('https://np-anotice-stock.eastmoney.com/api/security/ann');
    annUrl.searchParams.set('sr', '-1');
    annUrl.searchParams.set('page_size', '80');
    annUrl.searchParams.set('page_index', '1');
    annUrl.searchParams.set('ann_type', target.market === 'H' ? 'H' : 'A');
    annUrl.searchParams.set('client_source', 'web');
    annUrl.searchParams.set('stock_list', target.code);

    const res = await fetchImpl(annUrl, {
      headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 FinMap-Disclosure-Engine/1.0' },
      signal: AbortSignal.timeout(12000),
    });
    if (res.ok) {
      const body = await res.json();
      const rawList = body?.data?.list ?? [];
      let irContentCount = 0;
      for (const item of rawList) {
        const rawTitle = cleanWhitespace(item.title_ch || item.title);
        if (!rawTitle || !item.art_code) continue;
        if (NOISE_TITLE_RE.test(rawTitle) || !HIGH_VALUE_TITLE_RE.test(rawTitle)) continue;

        const dateStr = (item.eiTime || item.display_time || item.notice_date || '').slice(0, 10);
        const pubMs = Date.parse(dateStr ? `${dateStr}T08:00:00Z` : '');
        if (!Number.isFinite(pubMs) || pubMs < cutoff) continue;

        const title = rawTitle.startsWith(target.name)
          ? rawTitle.replace(/^([^:：]+)[:：]\s*/, '$1：')
          : `${target.name}：${rawTitle}`;
        const pdfUrl = `https://pdf.dfcfw.com/pdf/H2_${item.art_code}_1.pdf`;
        const meta = classifyFiling(title, target.board);

        let summary = meta.summaryFallback;
        if (/投资者关系活动记录表/.test(title) && irContentCount < 5) {
          irContentCount++;
          try {
            const contentUrl = `https://np-cnotice-stock.eastmoney.com/api/content/ann?art_code=${encodeURIComponent(item.art_code)}&client_source=web&page_index=1`;
            const cRes = await fetchImpl(contentUrl, {
              headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 FinMap-Disclosure-Engine/1.0' },
              signal: AbortSignal.timeout(8000),
            });
            if (cRes.ok) {
              const cBody = await cRes.json();
              const extracted = extractIrSummary(cBody?.data?.notice_content || '');
              if (extracted.length > 20) summary = extracted;
            }
          } catch {
            // Retain fallback summary on timeout
          }
        }

        results.push({
          id: `filing_${item.art_code}`,
          companyId: target.companyId,
          companyName: target.name,
          origin: 'filing',
          title,
          url: pdfUrl,
          published_at: new Date(pubMs).toISOString(),
          source_name: meta.sourceName,
          summary,
          monitorKind: meta.kind,
          monitorStage: meta.stage,
          evidence: 'official',
        });
      }
    }
  } catch {
    // Individual company announcement fetch failure should not abort the pipeline
  }

  // 2. Broker Research Reports (卖方个股深度与季报点评)
  if (target.market === 'A') {
    try {
      const beginDate = new Date(cutoff).toISOString().slice(0, 10);
      const endDate = new Date(Date.parse(now) + 86400000).toISOString().slice(0, 10);
      const repUrl = `https://reportapi.eastmoney.com/report/list?cb=&pageNo=1&pageSize=20&code=${encodeURIComponent(target.code)}&industryCode=*&industry=*&rating=*&ratingchange=*&beginTime=${beginDate}&endTime=${endDate}&fields=&qType=0`;
      const res = await fetchImpl(repUrl, {
        headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 FinMap-Disclosure-Engine/1.0' },
        signal: AbortSignal.timeout(12000),
      });
      if (res.ok) {
        const body = await res.json();
        const reports = body?.data ?? [];
        for (const r of reports) {
          if (!r.infoCode || !r.title) continue;
          const dateStr = (r.publishDate || '').slice(0, 10);
          const pubMs = Date.parse(dateStr ? `${dateStr}T06:00:00Z` : '');
          if (!Number.isFinite(pubMs) || pubMs < cutoff) continue;

          const broker = cleanWhitespace(r.orgSName || r.orgName || '券商研报');
          const rating = cleanWhitespace(r.sRatingName || r.emRatingName || '');
          const researcher = cleanWhitespace(r.researcher || '');
          const cleanTitle = cleanWhitespace(r.title);
          const prefix = `【${broker}${rating ? '·' + rating : ''}】`;
          const fullTitle = cleanTitle.includes(target.name)
            ? `${prefix}${cleanTitle}`
            : `${prefix}${target.name}：${cleanTitle}`;
          const pdfUrl = `https://pdf.dfcfw.com/pdf/H3_${r.infoCode}_1.pdf`;

          const epsParts = [];
          if (r.predictThisYearEps) {
            const eps = Number(r.predictThisYearEps).toFixed(2);
            const pe = r.predictThisYearPe ? ` (PE ${Number(r.predictThisYearPe).toFixed(1)}x)` : '';
            epsParts.push(`2026E EPS ${eps}元${pe}`);
          }
          if (r.predictNextYearEps) {
            const eps = Number(r.predictNextYearEps).toFixed(2);
            const pe = r.predictNextYearPe ? ` (PE ${Number(r.predictNextYearPe).toFixed(1)}x)` : '';
            epsParts.push(`2027E EPS ${eps}元${pe}`);
          }
          if (r.predictNextTwoYearEps) {
            const eps = Number(r.predictNextTwoYearEps).toFixed(2);
            const pe = r.predictNextTwoYearPe ? ` (PE ${Number(r.predictNextTwoYearPe).toFixed(1)}x)` : '';
            epsParts.push(`2028E EPS ${eps}元${pe}`);
          }

          const metaParts = [`发布机构：${r.orgName || broker}`];
          if (researcher) metaParts.push(`分析师：${researcher}`);
          if (rating) metaParts.push(`评级：${rating}`);
          if (r.attachPages) metaParts.push(`篇幅：${r.attachPages} 页`);
          if (epsParts.length) metaParts.push(`一致预期/盈利预测：${epsParts.join(' / ')}`);

          results.push({
            id: `report_${r.infoCode}`,
            companyId: target.companyId,
            companyName: target.name,
            origin: 'report',
            title: fullTitle,
            url: pdfUrl,
            published_at: new Date(pubMs).toISOString(),
            source_name: `${broker} · 个股研报${researcher ? ' (' + researcher + ')' : ''} (PDF)`,
            summary: metaParts.join(' ｜ '),
            monitorKind: 'research',
            monitorStage: 'reported',
            evidence: 'discovery',
          });
        }
      }
    } catch {
      // Retain announcements even if report API fails
    }
  }

  return results;
}

export async function fetchAllListedDisclosures({
  targets = LISTED_DISCLOSURE_TARGETS,
  fetchImpl = fetch,
  maxDays = 180,
  now = new Date().toISOString(),
  concurrency = 5,
} = {}) {
  const queue = [...targets];
  const all = [];
  async function worker() {
    while (queue.length > 0) {
      const target = queue.shift();
      if (!target) break;
      const items = await fetchCompanyDisclosures(target, { fetchImpl, maxDays, now });
      all.push(...items);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, () => worker()));
  return all.sort((a, b) => b.published_at.localeCompare(a.published_at) || a.id.localeCompare(b.id));
}
