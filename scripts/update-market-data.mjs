import fs from "node:fs/promises";
import path from "node:path";

const stocks = [
  { code: "300308", name: "中际旭创", secid: "0.300308", tencent: "sz300308" },
  { code: "000938", name: "紫光股份", secid: "0.000938", tencent: "sz000938" },
  { code: "300502", name: "新易盛", secid: "0.300502", tencent: "sz300502" },
  { code: "688008", name: "澜起科技", secid: "1.688008", tencent: "sh688008" },
  { code: "601138", name: "工业富联", secid: "1.601138", tencent: "sh601138" },
  { code: "000977", name: "浪潮信息", secid: "0.000977", tencent: "sz000977" },
];

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const now = process.env.MARKET_DATA_NOW
  ? new Date(process.env.MARKET_DATA_NOW)
  : new Date();
const beijingNow = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  weekday: "short",
}).formatToParts(now);

const part = (type) => beijingNow.find((item) => item.type === type)?.value;
const today = `${part("year")}-${part("month")}-${part("day")}`;
const weekday = part("weekday");
const minutes = Number(part("hour")) * 60 + Number(part("minute"));

if (weekday === "Sat" || weekday === "Sun") {
  console.log("SKIP_NON_TRADING_DAY: 周末不更新");
  process.exit(0);
}

if (minutes < 15 * 60 + 30) {
  console.log("SKIP_BEFORE_CLOSE: 尚未到北京时间 15:30");
  process.exit(0);
}

const forecastsPath = path.resolve("site/data/forecasts.json");
const recordsPath = path.resolve("site/data/records.json");
const [forecastPayload, records] = await Promise.all([
  fs.readFile(forecastsPath, "utf8").then(JSON.parse),
  fs.readFile(recordsPath, "utf8").then(JSON.parse),
]);

if (!Array.isArray(records)) {
  throw new Error("records.json 顶层必须是数组");
}

for (const stock of stocks) {
  const forecast = forecastPayload?.stocks?.[stock.code];
  if (
    !forecast ||
    ["revenue", "netProfit", "eps"].some(
      (field) => !Number.isFinite(Number(forecast[field])),
    )
  ) {
    throw new Error(`${stock.name} 的 2026E 预测数据不完整`);
  }
}

const eastmoneyHosts = (
  process.env.EASTMONEY_HOSTS ||
  "push2.eastmoney.com,push2delay.eastmoney.com,push2his.eastmoney.com"
)
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);
const eastmoneyFields = "f57,f58,f43,f55,f116,f162,f170,f86";

function formatBeijingDateTime(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((item) => item.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

async function fetchEastmoneyQuote(stock) {
  const errors = [];

  for (const host of eastmoneyHosts) {
    const url =
      `https://${host}/api/qt/stock/get?ut=fa5fd1943c7b386f172d6893dbfba10b&invt=2&fltt=2&secid=${stock.secid}` +
      `&fields=${eastmoneyFields}`;
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json,text/plain,*/*",
          Referer: "https://quote.eastmoney.com/",
          "User-Agent": "Mozilla/5.0",
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload?.data) throw new Error("未返回行情数据");
      const data = payload.data;
      if (String(data.f57) !== stock.code) {
        throw new Error(`股票代码不匹配：${data.f57}`);
      }
      return {
        price: Number(data.f43),
        marketCap: Number(data.f116),
        eps: Number(data.f55),
        pe: Number(data.f162),
        changePercent: Number(data.f170),
        quoteTime: formatBeijingDateTime(new Date(Number(data.f86) * 1000)),
        source: `eastmoney:${host}`,
      };
    } catch (error) {
      errors.push(`${host}: ${error.message}`);
      console.warn(`${stock.name} 从 ${host} 获取失败：${error.message}`);
      await sleep(1_500);
    }
  }

  throw new Error(errors.join("；"));
}

function findPreviousEps(stock) {
  for (const record of records) {
    const previous = record?.stocks?.find((item) => item.code === stock.code);
    if (Number.isFinite(Number(previous?.eps))) return Number(previous.eps);
  }
  throw new Error(`${stock.name} 没有可供备用行情使用的历史 EPS`);
}

async function fetchTencentQuote(stock) {
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`https://qt.gtimg.cn/q=${stock.tencent}`, {
        headers: {
          Accept: "text/plain,*/*",
          Referer: "https://gu.qq.com/",
          "User-Agent": "Mozilla/5.0",
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      const body = new TextDecoder("gb18030").decode(bytes);
      const match = body.match(/="([^"]*)"/);
      if (!match) throw new Error("返回格式无法识别");
      const fields = match[1].split("~");
      if (fields[2] !== stock.code) {
        throw new Error(`股票代码不匹配：${fields[2]}`);
      }
      if (!/^\d{14}$/.test(fields[30])) {
        throw new Error(`行情时间无效：${fields[30]}`);
      }
      const timestamp = fields[30];
      return {
        price: Number(fields[3]),
        marketCap: Number(fields[45]) * 100_000_000,
        eps: findPreviousEps(stock),
        pe: Number(fields[52]),
        changePercent: Number(fields[32]),
        quoteTime: `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)} ${timestamp.slice(8, 10)}:${timestamp.slice(10, 12)}:${timestamp.slice(12, 14)}`,
        source: "tencent",
      };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(attempt * 3_000);
    }
  }

  throw new Error(`${stock.name} 腾讯备用行情失败：${lastError?.message}`);
}

async function fetchQuote(stock) {
  try {
    return await fetchEastmoneyQuote(stock);
  } catch (eastmoneyError) {
    console.warn(
      `${stock.name} 的东方财富线路全部失败，切换腾讯备用行情：${eastmoneyError.message}`,
    );
    return fetchTencentQuote(stock);
  }
}

const quotes = [];
for (const stock of stocks) {
  const quote = await fetchQuote(stock);
  quotes.push(quote);
  console.log(`${stock.name} 行情来源：${quote.source}`);
  await sleep(500);
}

const quoteDates = quotes.map((quote) => quote.quoteTime.slice(0, 10));
if (quoteDates.some((date) => date !== today)) {
  console.log(
    `SKIP_NON_TRADING_DAY: ${today} 无当日行情，最近行情日期为 ${[
      ...new Set(quoteDates),
    ].join("、")}`,
  );
  process.exit(0);
}

const rows = quotes.map((quote, index) => ({
  code: stocks[index].code,
  name: stocks[index].name,
  price: quote.price,
  marketCap: quote.marketCap,
  eps: quote.eps,
  pe: quote.pe,
  changePercent: quote.changePercent,
  quoteTime: quote.quoteTime,
  forecast2026: {
    revenue: Number(forecastPayload.stocks[stocks[index].code].revenue),
    netProfit: Number(forecastPayload.stocks[stocks[index].code].netProfit),
    eps: Number(forecastPayload.stocks[stocks[index].code].eps),
    asOf: forecastPayload.asOf,
  },
}));

const numericFields = ["price", "marketCap", "eps", "pe", "changePercent"];
for (const row of rows) {
  for (const field of numericFields) {
    if (!Number.isFinite(row[field])) {
      throw new Error(`${row.name} 的 ${field} 数据无效`);
    }
  }
  if (row.price <= 0 || row.marketCap <= 0) {
    throw new Error(`${row.name} 的价格或市值无效`);
  }
}

if (new Set(rows.map((row) => row.code)).size !== stocks.length) {
  throw new Error("当天股票代码不完整或存在重复");
}

const nextRecords = records.filter((record) => record.date !== today);
nextRecords.push({ date: today, stocks: rows });
nextRecords.sort((a, b) => b.date.localeCompare(a.date));

const temporaryRecordsPath = `${recordsPath}.tmp`;
await fs.writeFile(
  temporaryRecordsPath,
  `${JSON.stringify(nextRecords, null, 2)}\n`,
  "utf8",
);
await fs.rename(temporaryRecordsPath, recordsPath);

console.log(`UPDATED: ${today} 已记录 ${rows.length} 只股票`);
