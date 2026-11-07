const LISTED_COMPANIES = {
  "orbbec":            { sym: "sh688322", code: "688322.SH", board: "科创板" },
  "cambricon":         { sym: "sh688256", code: "688256.SH", board: "科创板" },
  "moore-threads":     { sym: "sh688795", code: "688795.SH", board: "科创板" },
  "metax":             { sym: "sh688802", code: "688802.SH", board: "科创板" },
  "enflame":           { sym: "sh688801", code: "688801.SH", board: "科创板" },
  "unitree":           { sym: "sh688836", code: "688836.SH", board: "科创板" },
  "smic":              { sym: "sh688981", code: "688981.SH", board: "科创板" },
  "huahong-semi":      { sym: "sh688347", code: "688347.SH", board: "科创板" },
  "naura":             { sym: "sz002371", code: "002371.SZ", board: "深交所" },
  "amec":              { sym: "sh688012", code: "688012.SH", board: "科创板" },
  "acm-shanghai":      { sym: "sh688082", code: "688082.SH", board: "科创板" },
  "jcet":              { sym: "sh600584", code: "600584.SH", board: "上交所" },
  "empyrean":          { sym: "sz301269", code: "301269.SZ", board: "创业板" },
  "primarius":         { sym: "sh688206", code: "688206.SH", board: "科创板" },
  "leaderdrive":       { sym: "sh688017", code: "688017.SH", board: "科创板" },
  "leadshine":         { sym: "sz002979", code: "002979.SZ", board: "深交所" },
  "inovance":          { sym: "sz300124", code: "300124.SZ", board: "创业板" },
  "insta360":          { sym: "sh688775", code: "688775.SH", board: "科创板" },
  "catl":              { sym: "sz300750", code: "300750.SZ", board: "创业板" },
  "eve-energy":        { sym: "sz300014", code: "300014.SZ", board: "创业板" },
  "sungrow":           { sym: "sz300274", code: "300274.SZ", board: "创业板" },
  "longi":             { sym: "sh601012", code: "601012.SH", board: "上交所" },
  "quantumctek":       { sym: "sh688027", code: "688027.SH", board: "科创板" },
  "ubtech":            { sym: "hk09880",  code: "09880.HK",  board: "港股" },
  "robosense":         { sym: "hk02498",  code: "02498.HK",  board: "港股" },
  "dobot":             { sym: "hk02432",  code: "02432.HK",  board: "港股" },
  "biren":             { sym: "hk06082",  code: "06082.HK",  board: "港股" },
  "iluvatar":          { sym: "hk09903",  code: "09903.HK",  board: "港股" },
  "hesai":             { sym: "hk02525",  code: "02525.HK",  board: "港股" },
  "zhipu":             { sym: "hk02513",  code: "02513.HK",  board: "港股" },
  "minimax":           { sym: "hk00100",  code: "00100.HK",  board: "港股" },
  "mech-mind":         { sym: "hk09615",  code: "09615.HK",  board: "港股" },
  "seyond":            { sym: "hk02665",  code: "02665.HK",  board: "港股" },
  "lightelligence":    { sym: "hk01879",  code: "01879.HK",  board: "港股" },
  "direct-drive-tech": { sym: "hk06731",  code: "06731.HK",  board: "港股" },
  "momenta":           { sym: "hk06880",  code: "06880.HK",  board: "港股" },
  "nvidia":            { sym: "usNVDA",   code: "NVDA.US",   board: "NASDAQ" },
  "amd":               { sym: "usAMD",    code: "AMD.US",    board: "NASDAQ" },
  "tsmc":              { sym: "usTSM",    code: "TSM.US",    board: "NYSE" },
  "asml":              { sym: "usASML",   code: "ASML.US",   board: "NASDAQ" },
  "applied-materials": { sym: "usAMAT",   code: "AMAT.US",   board: "NASDAQ" },
  "synopsys":          { sym: "usSNPS",   code: "SNPS.US",   board: "NASDAQ" },
  "intuitive-surgical":{ sym: "usISRG",   code: "ISRG.US",   board: "NASDAQ" },
  "coreweave":         { sym: "usCRWV",   code: "CRWV.US",   board: "NASDAQ" },
  "cerebras":          { sym: "usCBRS",   code: "CBRS.US",   board: "NASDAQ" },
  "pony-ai":           { sym: "usPONY",   code: "PONY.US",   board: "NASDAQ" },
  "weride":            { sym: "usWRD",    code: "WRD.US",    board: "NASDAQ" },
  "aurora":            { sym: "usAUR",    code: "AUR.US",    board: "NASDAQ" },
  "ouster":            { sym: "usOUST",   code: "OUST.US",   board: "NYSE" },
  "rocket-lab":        { sym: "usRKLB",   code: "RKLB.US",   board: "NASDAQ" },
  "planet-labs":       { sym: "usPL",     code: "PL.US",     board: "NYSE" },
  "ehang":             { sym: "usEH",     code: "EH.US",     board: "NASDAQ" },
  "joby":              { sym: "usJOBY",   code: "JOBY.US",   board: "NYSE" },
  "archer":            { sym: "usACHR",   code: "ACHR.US",   board: "NYSE" },
  "quantumscape":      { sym: "usQS",     code: "QS.US",     board: "NYSE" },
  "ionq":              { sym: "usIONQ",   code: "IONQ.US",   board: "NYSE" },
  "quantinuum":        { sym: "usQNT",    code: "QNT.US",    board: "NASDAQ" },
  "xanadu":            { sym: "usXNDU",   code: "XNDU.US",   board: "NASDAQ" },
  "agility":           { sym: "usAGLT",   code: "AGLT.US",   board: "NASDAQ" },
  "spacex":            { sym: "usSPCX",   code: "SPCX.US",   board: "NASDAQ" },
};

function formatTime(raw) {
  if (!raw) return "";
  if (/^\d{14}$/.test(raw)) {
    return `${raw.slice(4, 6)}-${raw.slice(6, 8)} ${raw.slice(8, 10)}:${raw.slice(10, 12)}`;
  }
  const m = raw.match(/(\d{2})[-/](\d{2})\s+(\d{2}:\d{2})/);
  return m ? `${m[1]}-${m[2]} ${m[3]}` : raw;
}

export async function onRequestGet({ request, waitUntil }) {
  const key = new Request(new URL("/api/quotes", request.url).href);
  const cached = await caches.default.match(key);
  if (cached) return cached;

  try {
    const syms = Object.values(LISTED_COMPANIES).map((x) => x.sym);
    const upstream = await fetch("https://qt.gtimg.cn/q=" + syms.join(","), {
      signal: AbortSignal.timeout(8000),
    });
    if (!upstream.ok) throw new Error("upstream_error");
    const text = new TextDecoder("gbk").decode(await upstream.arrayBuffer());
    const bySym = new Map();
    for (const line of text.trim().split("\n")) {
      const p = line.split("~");
      const sym = (p[0] || "").split("=")[0].replace(/^v_/, "");
      const price = Number(p[3]);
      const cap45 = Number(p[45]);
      const chg = Number(p[32]);
      if (sym && Number.isFinite(cap45) && cap45 > 0) {
        bySym.set(sym, {
          price,
          cap45,
          chg: Number.isFinite(chg) ? chg : 0,
          time: formatTime(p[30] || ""),
        });
      }
    }

    const quotes = {};
    for (const [id, info] of Object.entries(LISTED_COMPANIES)) {
      const q = bySym.get(info.sym);
      if (!q) continue;
      let capStr, priceStr;
      if (info.sym.startsWith("sh") || info.sym.startsWith("sz")) {
        capStr = `${q.cap45.toFixed(1).replace(/\.0$/, "")} 亿元`;
        priceStr = `¥${q.price.toFixed(2)}`;
      } else if (info.sym.startsWith("hk")) {
        capStr = `${q.cap45.toFixed(1).replace(/\.0$/, "")} 亿港元`;
        priceStr = `HK$${q.price.toFixed(2)}`;
      } else {
        capStr =
          q.cap45 >= 10
            ? `$${(q.cap45 / 10).toFixed(1).replace(/\.0$/, "")}B`
            : `$${Math.round(q.cap45 * 100)}M`;
        priceStr = `$${q.price.toFixed(2)}`;
      }
      const chgStr = `${q.chg >= 0 ? "+" : ""}${q.chg.toFixed(2)}%`;
      quotes[id] = {
        code: info.code,
        board: info.board,
        price: q.price,
        chg: q.chg,
        capText: capStr,
        shortText: `${info.code} · ${capStr}`,
        cardText: `${info.board} ${info.code} · 实时市值 ${capStr}`,
        fullText: `${info.board} ${info.code} · 实时市值 ${capStr}（股价 ${priceStr}，${chgStr}${q.time ? " · " + q.time : ""}）`,
      };
    }

    const body = JSON.stringify({
      updatedAt: new Date().toISOString(),
      count: Object.keys(quotes).length,
      quotes,
    });
    const res = new Response(body, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=120, s-maxage=120",
        "x-content-type-options": "nosniff",
      },
    });
    waitUntil(caches.default.put(key, res.clone()));
    return res;
  } catch {
    return Response.json(
      { error: "quotes_temporarily_unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
