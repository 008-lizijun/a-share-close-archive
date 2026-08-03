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
let reportRecords = [];
let selectedDate = "";
let visibleMonth = "";

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

const formatMonth = (value) => {
  const [year, month] = value.split("-").map(Number);
  return `${year} 年 ${month} 月`;
};

const shiftMonth = (value, offset) => {
  const [year, month] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
};

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
      `2026预测口径与来源（每日检查，最近检查 ${
        forecastPayload.lastCheckedAt || forecastPayload.asOf
      }）`,
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

function createDailyCard(day, isLatest) {
  const card = element("article", "daily-card");
  const head = element("div", "daily-card-head");
  const date = element("div");
  date.append(element("h2", "", formatDate(day.date)));
  if (isLatest) date.append(element("span", "latest-pill", "最新"));

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

function createCalendar() {
  const wrapper = element("div", "date-selector");
  const panel = element("div", "calendar-panel");
  panel.setAttribute("aria-label", "选择报告日期");
  const header = element("div", "calendar-header");
  const availableMonths = reportRecords
    .map((record) => record.date.slice(0, 7))
    .sort();
  const firstMonth = availableMonths[0];
  const lastMonth = availableMonths.at(-1);

  const previous = element("button", "calendar-nav-button", "←");
  previous.type = "button";
  previous.setAttribute("aria-label", "上一个月");
  previous.disabled = visibleMonth <= firstMonth;
  previous.addEventListener("click", () => {
    visibleMonth = shiftMonth(visibleMonth, -1);
    renderReportView();
  });

  const next = element("button", "calendar-nav-button", "→");
  next.type = "button";
  next.setAttribute("aria-label", "下一个月");
  next.disabled = visibleMonth >= lastMonth;
  next.addEventListener("click", () => {
    visibleMonth = shiftMonth(visibleMonth, 1);
    renderReportView();
  });
  header.append(previous, element("strong", "", formatMonth(visibleMonth)), next);

  const weekdays = element("div", "calendar-grid calendar-weekdays");
  ["一", "二", "三", "四", "五", "六", "日"].forEach((weekday) =>
    weekdays.append(element("span", "", weekday)),
  );

  const calendar = element("div", "calendar-grid");
  const [year, month] = visibleMonth.split("-").map(Number);
  const leadingBlankDays =
    (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const availableDates = new Set(reportRecords.map((record) => record.date));
  const latestDate = reportRecords[0].date;

  for (let index = 0; index < leadingBlankDays; index += 1) {
    calendar.append(element("span", "calendar-blank"));
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateValue = `${visibleMonth}-${String(day).padStart(2, "0")}`;
    const hasRecord = availableDates.has(dateValue);
    const classNames = ["calendar-day"];
    if (dateValue === selectedDate) classNames.push("selected");
    if (dateValue === latestDate) classNames.push("latest");
    const button = element("button", classNames.join(" "), String(day));
    button.type = "button";
    button.disabled = !hasRecord;
    button.setAttribute("aria-pressed", String(dateValue === selectedDate));
    button.setAttribute(
      "aria-label",
      hasRecord ? `查看 ${formatDate(dateValue)}` : `${dateValue} 无收盘记录`,
    );
    if (hasRecord) {
      button.addEventListener("click", () => {
        selectedDate = dateValue;
        exportStatus.textContent = "";
        renderReportView();
      });
    }
    calendar.append(button);
  }
  panel.append(
    header,
    weekdays,
    calendar,
    element("p", "calendar-note", "只有已有收盘记录的交易日可以选择"),
  );

  const selectedRecord =
    reportRecords.find((record) => record.date === selectedDate) ||
    reportRecords[0];
  const copy = element("div", "selected-date-copy");
  copy.append(
    element("span", "", "当前展示"),
    element("strong", "", formatDate(selectedRecord.date)),
    element(
      "p",
      "",
      "打开页面时默认显示最新交易日，可从日历切换历史日期。",
    ),
  );
  wrapper.append(panel, copy);
  return wrapper;
}

function renderReportView() {
  recordsRoot.replaceChildren();
  if (!reportRecords.length) {
    recordsRoot.append(element("div", "empty-records", "尚无收盘记录"));
    return;
  }
  const selectedRecord =
    reportRecords.find((record) => record.date === selectedDate) ||
    reportRecords[0];
  recordsRoot.append(
    createCalendar(),
    createDailyCard(selectedRecord, selectedRecord.date === reportRecords[0].date),
  );
}

function renderRecords(records) {
  reportRecords = records;
  if (!reportRecords.length) {
    renderReportView();
    return;
  }
  if (!reportRecords.some((record) => record.date === selectedDate)) {
    selectedDate = reportRecords[0].date;
  }
  visibleMonth = selectedDate.slice(0, 7);
  renderReportView();
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
