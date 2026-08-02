export const basePrintColumns = [
  { key: "name", label: "Name" },
  { key: "date", label: "Date" },
  { key: "reference_no", label: "Reference" },
  { key: "amount", label: "Amount" },
  { key: "status", label: "Status" },
];

export function getVisibleColumns(columns, visibleKeys = []) {
  if (!Array.isArray(columns)) return [];
  if (!visibleKeys.length) return columns;
  return columns.filter((column) => visibleKeys.includes(column.key));
}
