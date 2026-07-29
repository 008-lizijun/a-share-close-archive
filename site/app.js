const recordsRoot = document.querySelector("#records");
const summaryRoot = document.querySelector("#summary-content");

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

function renderSummary(latest) {
  summaryRoot.replaceChildren();

  if (!latest) {
    summaryRoot.className = "waiting-state";
    summaryRoot.append(
      element("span", "waiting-line"),
      element("strong", "", "等待首次收盘归档"),
      element("p", "", "交易日 15:30 后自动生成"),
    );
    return;
  }

  summaryRoot.className = "summary-data";
  summaryRoot.append(element("strong", "latest-date", formatDate(latest.date)));

  const grid = element("div", "summary-grid");
  const sample = element("div");
  sample.append(
    element("span", "", "样本"),
    element("b", "", `${latest.stocks.length} 只`),
  );
  const rising = latest.stocks.filter(
    (stock) => Number(stock.changePercent) >= 0,
  ).length;
  const rise = element("div");
  rise.append(
    element("span", "", "上涨"),
    element("b", "rise", `${rising} 只`),
  );
  grid.append(sample, rise);
  summaryRoot.append(grid);
}

function createStockRow(stock) {
  const row = element("tr");

  const company = element("td");
  company.append(
    element("strong", "", stock.name),
    element("small", "", stock.code),
  );

  const price = element(
    "td",
    "price",
    `¥ ${formatNumber(Number(stock.price))}`,
  );

  const changeValue = Number(stock.changePercent);
  const change = element(
    "td",
    changeValue >= 0 ? "rise" : "fall",
    `${changeValue >= 0 ? "+" : ""}${formatNumber(changeValue)}%`,
  );

  row.append(
    company,
    price,
    change,
    element("td", "", formatMoney(Number(stock.marketCap))),
    element("td", "", formatNumber(Number(stock.eps), 3)),
    element("td", "", formatNumber(Number(stock.pe))),
  );
  return row;
}

function createDailyCard(day, index, total) {
  const card = element("article", "daily-card");
  const head = element("div", "daily-card-head");
  const left = element("div");
  left.append(element("span", "date-index", String(total - index).padStart(2, "0")));

  const dateCopy = element("div");
  dateCopy.append(
    element("h3", "", formatDate(day.date)),
    element("p", "", "收盘快照 · 北京时间"),
  );
  left.append(dateCopy);
  head.append(left);
  if (index === 0) head.append(element("span", "latest-pill", "最新"));

  const tableWrap = element("div", "table-wrap");
  const table = element("table");
  const thead = element("thead");
  const headingRow = element("tr");
  ["公司 / 代码", "收盘价", "涨跌幅", "总市值", "每股收益", "PE（动）"].forEach(
    (label) => headingRow.append(element("th", "", label)),
  );
  thead.append(headingRow);

  const tbody = element("tbody");
  day.stocks.forEach((stock) => tbody.append(createStockRow(stock)));
  table.append(thead, tbody);
  tableWrap.append(table);

  const quoteTime = day.stocks[0]?.quoteTime || `${day.date} 15:00:00`;
  const note = element(
    "p",
    "quote-note",
    `数据时间：${quoteTime} · 数据仅供信息参考，不构成投资建议`,
  );
  card.append(head, tableWrap, note);
  return card;
}

function renderRecords(records) {
  recordsRoot.replaceChildren();
  if (!records.length) {
    const empty = element("div", "empty-records");
    empty.append(
      element("div", "empty-symbol", "15:30"),
      element("h3", "", "第一张收盘表将在交易日收市后出现"),
      element(
        "p",
        "",
        "遇到周末或 A 股休市日，系统不会写入空白或重复记录。",
      ),
    );
    recordsRoot.append(empty);
    return;
  }

  records.forEach((day, index) => {
    recordsRoot.append(createDailyCard(day, index, records.length));
  });
}

async function loadRecords() {
  try {
    const response = await fetch(`./data/records.json?v=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload = await response.json();
    const records = Array.isArray(payload)
      ? payload
          .filter((record) => record?.date && Array.isArray(record?.stocks))
          .sort((a, b) => b.date.localeCompare(a.date))
      : [];

    renderSummary(records[0]);
    renderRecords(records);
  } catch (error) {
    console.error("无法读取收盘记录", error);
    summaryRoot.className = "waiting-state";
    summaryRoot.replaceChildren(
      element("span", "waiting-line"),
      element("strong", "", "数据暂时无法载入"),
      element("p", "", "请稍后刷新页面"),
    );
    recordsRoot.replaceChildren();
    const empty = element("div", "empty-records");
    empty.append(
      element("div", "empty-symbol", "—"),
      element("h3", "", "收盘档案暂时无法载入"),
      element("p", "", "请稍后刷新页面重试。"),
    );
    recordsRoot.append(empty);
  }
}

loadRecords();
