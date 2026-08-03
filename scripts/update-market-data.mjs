import fs from "node:fs/promises";
import path from "node:path";

const stocks = [
  { code: "300308", name: "中际旭创", secid: "0.300308" },
  { code: "000938", name: "紫光股份", secid: "0.000938" },
  { code: "300502", name: "新易盛", secid: "0.300502" },
  { code: "688008", name: "澜起科技", secid: "1.688008" },
  { code: "601138", name: "工业富联", secid: "1.601138" },
  { code: "000977", name: "浪潮信息", secid: "0.000977" },
];

const beijingNow = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  weekday: "short",
}).formatToParts(new Date());

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

const fields = "f57,f58,f43,f55,f116,f162,f170,f86";
const forecastsPath = path.resolve("site/data/forecasts.json");
const forecastPayload = JSON.parse(await fs.readFile(forecastsPath, "utf8"));

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

async function fetchQuote(stock) {
  const url =
    `https://push2.eastmoney.com/api/qt/stock/get?ut=fa5fd1943c7b386f172d6893dbfba10b&invt=2&fltt=2&secid=${stock.secid}` +
    `&fields=${fields}`;

  let lastError;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json,text/plain,*/*",
          Referer: "https://quote.eastmoney.com/",
          "User-Agent": "Mozilla/5.0",
        },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload?.data) throw new Error("行情接口未返回数据");
      return payload.data;
    } catch (error) {
      lastError = error;
      if (attempt < 6) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 3_000));
      }
    }
  }
  throw new Error(`${stock.name} 行情请求失败：${lastError?.message}`);
}

const rawRows = [];
for (const stock of stocks) {
  rawRows.push(await fetchQuote(stock));
  await new Promise((resolve) => setTimeout(resolve, 500));
}
const quoteDates = rawRows.map((data) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Number(data.f86) * 1000)),
);

if (quoteDates.some((date) => date !== today)) {
  console.log(
    `SKIP_NON_TRADING_DAY: ${today} 无当日行情，最近行情日期为 ${[
      ...new Set(quoteDates),
    ].join("、")}`,
  );
  process.exit(0);
}

const rows = rawRows.map((data, index) => {
  const quote = new Date(Number(data.f86) * 1000);
  const quoteTime = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
    .format(quote)
    .replaceAll("/", "-");

  return {
    code: stocks[index].code,
    name: stocks[index].name,
    price: Number(data.f43),
    marketCap: Number(data.f116),
    eps: Number(data.f55),
    pe: Number(data.f162),
    changePercent: Number(data.f170),
    quoteTime,
    forecast2026: {
      revenue: Number(forecastPayload.stocks[stocks[index].code].revenue),
      netProfit: Number(forecastPayload.stocks[stocks[index].code].netProfit),
      eps: Number(forecastPayload.stocks[stocks[index].code].eps),
      asOf: forecastPayload.asOf,
    },
  };
});

const numericFields = ["price", "marketCap", "eps", "pe", "changePercent"];
for (const row of rows) {
  for (const field of numericFields) {
    if (!Number.isFinite(row[field])) {
      throw new Error(`${row.name} 的 ${field} 数据无效`);
    }
  }
}

const recordsPath = path.resolve("site/data/records.json");
const records = JSON.parse(await fs.readFile(recordsPath, "utf8"));
const nextRecords = records.filter((record) => record.date !== today);
nextRecords.push({ date: today, stocks: rows });
nextRecords.sort((a, b) => b.date.localeCompare(a.date));
await fs.writeFile(
  recordsPath,
  `${JSON.stringify(nextRecords, null, 2)}\n`,
  "utf8",
);

console.log(`UPDATED: ${today} 已记录 ${rows.length} 只股票`);
