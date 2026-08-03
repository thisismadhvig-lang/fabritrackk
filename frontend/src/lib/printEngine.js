const DEFAULT_COMPANY = {
  name: "FABRITRACK ERP",
  address: "ERP Operations • Professional Business Reporting",
  phone: "",
  gst: "",
};

export function getSelectionKey(row, index) {
  if (!row) return `row-${index}`;
  const candidates = [
    row.id,
    row.uuid,
    row.reference_id,
    row.referenceNo,
    row.reference_no,
    row.dispatch_no,
    row.dispatchNo,
    row.order_number,
    row.orderNo,
    row.invoice_no,
    row.challan_no,
    row.material_name,
    row.article_number,
    row.article_barcode,
    row.name,
  ];
  const selected = candidates.find((value) => value !== undefined && value !== null && value !== "");
  if (selected !== undefined) return String(selected);
  return `row-${index}`;
}

export function buildPrintableRows({ mode, selectedRows = [], currentPageRows = [], filteredRows = [], allRows = [] }) {
  if (mode === "selected") return selectedRows;
  if (mode === "page") return currentPageRows;
  if (mode === "filtered") return filteredRows;
  return allRows;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatCellValue(row, column) {
  if (typeof column.render === "function") {
    return column.render(row);
  }
  const value = row?.[column.key];
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
  }
  return String(value);
}

function buildSummaryRows(summary = []) {
  if (!Array.isArray(summary) || !summary.length) return "";
  const rows = summary
    .map((item) => `<tr><th>${escapeHtml(item.label)}</th><td>${escapeHtml(item.value)}</td></tr>`)
    .join("");
  return `
    <section class="summary-box">
      <h3>Summary</h3>
      <table class="summary-table">
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

export function buildReportHtml({
  moduleName,
  rows = [],
  columns = [],
  summary = [],
  reportTitle,
  reportPeriod,
  printedBy = "System",
  options = {},
  bodyHtml = "",
  company = DEFAULT_COMPANY,
}) {
  const showCompanyHeader = options.showCompanyHeader !== false;
  const showSummary = options.showSummary !== false;
  const showFooter = options.showFooter !== false;
  const pageSize = options.paperSize || "A4";
  const orientation = options.orientation || "portrait";
  const margin = options.margin || "normal";
  const marginStyle = {
    narrow: "10mm",
    normal: "14mm",
    wide: "20mm",
  }[margin] || "14mm";

  const tableRows = rows.length
    ? rows
        .map((row) => {
          const cells = columns
            .map((column) => `<td class="cell ${column.align === "right" ? "text-right" : ""}">${escapeHtml(formatCellValue(row, column))}</td>`)
            .join("");
          return `<tr>${cells}</tr>`;
        })
        .join("")
    : `<tr><td colspan="${columns.length || 1}" class="no-data">No records available for this report.</td></tr>`;

  const tableHeader = columns.length
    ? `<thead><tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}</tr></thead>`
    : "";

  const bodyContent = bodyHtml || `
    <table class="data-table">
      ${tableHeader}
      <tbody>${tableRows}</tbody>
    </table>`;

  const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const headerMarkup = showCompanyHeader
    ? `
      <header class="report-header">
        <div>
          <div class="company-name">${escapeHtml(company.name)}</div>
          <div class="company-meta">${escapeHtml(company.address)}</div>
          ${company.phone ? `<div class="company-meta">Phone: ${escapeHtml(company.phone)}</div>` : ""}
          ${company.gst ? `<div class="company-meta">GST: ${escapeHtml(company.gst)}</div>` : ""}
        </div>
        <div class="header-right">
          <div class="report-title">${escapeHtml(reportTitle || moduleName || "ERP Report")}</div>
          <div class="meta-line">Printed On: ${today}</div>
          <div class="meta-line">Printed By: ${escapeHtml(printedBy)}</div>
          <div class="meta-line">Period: ${escapeHtml(reportPeriod || "All Records")}</div>
        </div>
      </header>`
    : "";

  const summaryMarkup = showSummary ? buildSummaryRows(summary) : "";
  const footerMarkup = showFooter
    ? `
      <footer class="report-footer">
        <span>Page <span class="page-number"></span></span>
        <span>Prepared By: ${escapeHtml(printedBy)}</span>
        <span>Generated from FABRITRACK ERP</span>
      </footer>`
    : "";

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(reportTitle || moduleName || "ERP Report")}</title>
    <style>
      @page { size: ${pageSize} ${orientation}; margin: ${marginStyle}; }
      body {
        font-family: "Segoe UI", Arial, sans-serif;
        color: #111827;
        background: #ffffff;
        margin: 0;
        padding: 0;
      }
      .report-shell {
        padding: 12px 14px 20px;
      }
      .report-header {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        border-bottom: 2px solid #111827;
        padding-bottom: 10px;
        margin-bottom: 14px;
      }
      .company-name {
        font-size: 18px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .company-meta {
        font-size: 11px;
        color: #4b5563;
        margin-top: 2px;
      }
      .header-right {
        text-align: right;
      }
      .report-title {
        font-size: 16px;
        font-weight: 700;
        margin-bottom: 4px;
      }
      .meta-line {
        font-size: 11px;
        color: #4b5563;
      }
      .report-subtitle {
        font-size: 12px;
        color: #374151;
        margin-bottom: 12px;
      }
      .summary-box {
        border: 1px solid #d1d5db;
        padding: 10px 12px;
        margin-bottom: 12px;
        background: #f9fafb;
      }
      .summary-box h3 {
        margin: 0 0 8px;
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #374151;
      }
      .summary-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 11px;
      }
      .summary-table th, .summary-table td {
        border-bottom: 1px solid #e5e7eb;
        padding: 4px 0;
        text-align: left;
      }
      .summary-table th { font-weight: 600; color: #111827; width: 60%; }
      .summary-table td { color: #374151; }
      .data-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 10px;
      }
      .data-table th, .data-table td {
        border: 1px solid #d1d5db;
        padding: 6px 7px;
        text-align: left;
        vertical-align: top;
      }
      .data-table th {
        background: #f3f4f6;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.03em;
      }
      .text-right { text-align: right; }
      .no-data { text-align: center; color: #6b7280; padding: 20px; }
      .report-footer {
        margin-top: 16px;
        padding-top: 10px;
        border-top: 1px solid #d1d5db;
        display: flex;
        justify-content: space-between;
        font-size: 10px;
        color: #6b7280;
      }
      .report-section {
        margin-bottom: 12px;
      }
      .report-section h3 {
        font-size: 13px;
        margin: 0 0 8px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .report-table-inline {
        width: 100%;
        border-collapse: collapse;
      }
      .report-table-inline th, .report-table-inline td {
        border: 1px solid #d1d5db;
        padding: 6px 7px;
        font-size: 10px;
      }
      .report-table-inline th {
        background: #f3f4f6;
        text-align: left;
      }
      @media print {
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .report-shell { padding: 0; }
      }
    </style>
  </head>
  <body>
    <div class="report-shell">
      ${headerMarkup}
      ${moduleName ? `<div class="report-subtitle">Module: ${escapeHtml(moduleName)}</div>` : ""}
      ${summaryMarkup}
      ${bodyContent}
      ${footerMarkup}
    </div>
  </body>
</html>`;
}

export function openPrintWindow(html, action = "print") {
  const popup = window.open("", "_blank", "width=1280,height=900,scrollbars=yes");
  if (!popup) {
    console.warn("Printing requires popups to be enabled in this browser.");
    return;
  }
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  popup.focus();
  setTimeout(() => {
    try {
      popup.print();
    } catch (error) {
      console.error("Printing failed", error);
    }
  }, 350);
  if (action === "download") {
    setTimeout(() => {
      try {
        popup.document.title = "FABRITRACK ERP Report";
      } catch (error) {
        console.error(error);
      }
    }, 450);
  }
}
