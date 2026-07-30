const recordsRoot = document.querySelector("#records");
const exportStatus = document.querySelector("#export-status");

const trackedStocks = [
  ["中际旭创", "300308"],
  ["紫光股份", "000938"],
  ["新易盛", "300502"],
  ["澜起科技", "688008"],
  ["工业富联", "601138"],
  ["浪潮信息", "000977"],
];

let forecastPayload = { asOf: "", method: "", stocks: {} };

const formatMoney = (value) => {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1_000_000_000_000) {
    return `${(value / 1_000_000_000_000).toFixed(2)} 万亿`;
  }
  return `${(value / 100_000_000).toFixed(2)} 亿`;
};

const formatNumber = (value, digits = 2) =>
  Number.isFinite(value) ? value.toFixed(digits) : "—";

const formatDate = (value) =>
  new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${value}T12:00:00+08:00`));

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const getForecast = (stock) =>
  stock.forecast2026 || forecastPayload.stocks?.[stock.code];

const getForecastPe = (stock) => {
  const forecast = getForecast(stock);
  return Number(forecast?.eps) > 0
    ? Number(stock.price) / Number(forecast.eps)
    : Number.NaN;
};

function exportDay(day) {
  if (!window.XLSX) {
    exportStatus.textContent = "导出组件仍在载入，请稍后再试。";
    return;
  }

  const rows = day.stocks.map((stock) => {
    const forecast = getForecast(stock);
    const forecastPe = getForecastPe(stock);
    return {
      日期: day.date,
      公司: stock.name,
      股票代码: stock.code,
      "收盘价（元）": Number(stock.price),
      "涨跌幅（%）": Number(stock.changePercent),
      "总市值（亿元）": Number(
        (Number(stock.marketCap) / 100_000_000).toFixed(2),
      ),
      "每股收益（元）": Number(Number(stock.eps).toFixed(3)),
      "动态PE（倍）": Number(Number(stock.pe).toFixed(2)),
      "2026预计营收（亿元）": forecast?.revenue ?? "",
      "2026预计净利润（亿元）": forecast?.netProfit ?? "",
      "2026预计最终PE（倍）": Number.isFinite(forecastPe)
        ? Number(forecastPe.toFixed(2))
        : "",
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet["!cols"] = [
    { wch: 13 },
    { wch: 12 },
    { wch: 12 },
    { wch: 14 },
    { wch: 14 },
    { wch: 18 },
    { wch: 16 },
    { wch: 14 },
    { wch: 24 },
    { wch: 25 },
    { wch: 18 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, day.date);
  XLSX.writeFileXLSX(workbook, `每日股价报告-${day.date}.xlsx`, {
    compression: true,
  });
  exportStatus.textContent = `${day.date} 的 XLSX 文件已生成。`;
}

function createStockRow(stock) {
  const row = element("tr");
  const company = element("td");
  company.append(
    element("strong", "", stock.name),
    element("small", "", stock.code),
  );

  const changeValue = Number(stock.changePercent);
  const forecast = getForecast(stock);
  const forecastPe = getForecastPe(stock);

  row.append(
    company,
    element("td", "price", `¥ ${formatNumber(Number(stock.price))}`),
    element(
      "td",
      changeValue >= 0 ? "rise" : "fall",
      `${changeValue >= 0 ? "+" : ""}${formatNumber(changeValue)}%`,
    ),
    element("td", "", formatMoney(Number(stock.marketCap))),
    element("td", "", formatNumber(Number(stock.eps), 3)),
    element("td", "", formatNumber(Number(stock.pe))),
    element(
      "td",
      "forecast-cell",
      forecast ? `${formatNumber(Number(forecast.revenue))} 亿` : "—",
    ),
    element(
      "td",
      "forecast-cell",
      forecast ? `${formatNumber(Number(forecast.netProfit))} 亿` : "—",
    ),
    element("td", "forecast-cell", formatNumber(forecastPe)),
  );
  return row;
}

function createForecastSources() {
  const details = element("details", "forecast-sources");
  details.append(
    element(
      "summary",
      "",
      `2026E 预测口径与来源（截至 ${forecastPayload.asOf}）`,
    ),
    element("p", "", forecastPayload.method),
  );

  const sourceList = element("div", "source-list");
  trackedStocks.forEach(([name, code]) => {
    const forecast = forecastPayload.stocks[code];
    const item = element("div");
    const link = element("a", "", name);
    link.href = forecast.sourceUrl;
    link.target = "_blank";
    link.rel = "noreferrer";
    item.append(
      link,
      element(
        "span",
        "",
        `${forecast.coverage} 家机构 · ${forecast.basis}`,
      ),
    );
    sourceList.append(item);
  });
  details.append(sourceList);
  return details;
}

function createDailyCard(day, index) {
  const card = element("article", "daily-card");
  const head = element("div", "daily-card-head");
  const date = element("div");
  date.append(element("h2", "", formatDate(day.date)));
  if (index === 0) date.append(element("span", "latest-pill", "最新"));

  const exportButton = element("button", "export-button", "导出 XLSX");
  exportButton.type = "button";
  exportButton.addEventListener("click", () => exportDay(day));
  head.append(date, exportButton);

  const tableWrap = element("div", "table-wrap");
  const table = element("table");
  const thead = element("thead");
  const headingRow = element("tr");
  [
    "公司 / 代码",
    "收盘价",
    "涨跌幅",
    "总市值",
    "每股收益",
    "PE（动）",
    "2026预计营收",
    "2026预计净利润",
    "2026预计最终PE",
  ].forEach((label, columnIndex) => {
    headingRow.append(
      element("th", columnIndex >= 6 ? "forecast-column" : "", label),
    );
  });
  thead.append(headingRow);

  const tbody = element("tbody");
  day.stocks.forEach((stock) => tbody.append(createStockRow(stock)));
  table.append(thead, tbody);
  tableWrap.append(table);

  const notes = element("div", "card-notes");
  notes.append(
    element(
      "p",
      "",
      `数据时间：${day.stocks[0]?.quoteTime || `${day.date} 15:00:00`}`,
    ),
    createForecastSources(),
  );
  card.append(head, tableWrap, notes);
  return card;
}

function renderRecords(records) {
  recordsRoot.replaceChildren();
  if (!records.length) {
    recordsRoot.append(element("div", "empty-records", "尚无收盘记录"));
    return;
  }
  records.forEach((day, index) => {
    recordsRoot.append(createDailyCard(day, index));
  });
}

async function loadReport() {
  try {
    const cacheBust = Date.now();
    const [recordsResponse, forecastsResponse] = await Promise.all([
      fetch(`./data/records.json?v=${cacheBust}`, { cache: "no-store" }),
      fetch(`./data/forecasts.json?v=${cacheBust}`, { cache: "no-store" }),
    ]);
    if (!recordsResponse.ok || !forecastsResponse.ok) {
      throw new Error(
        `HTTP ${recordsResponse.status}/${forecastsResponse.status}`,
      );
    }

    const recordsPayload = await recordsResponse.json();
    forecastPayload = await forecastsResponse.json();
    const records = Array.isArray(recordsPayload)
      ? recordsPayload
          .filter((record) => record?.date && Array.isArray(record?.stocks))
          .sort((a, b) => b.date.localeCompare(a.date))
      : [];
    renderRecords(records);
  } catch (error) {
    console.error("无法读取每日股价报告", error);
    recordsRoot.replaceChildren(
      element("div", "empty-records", "数据暂时无法载入，请稍后刷新。"),
    );
  }
}

loadReport();
