export default function TableContainer({ children, className = "" }) {
  return <div className={`overflow-hidden rounded-[16px] border border-slate-200 bg-white ${className}`.trim()}>{children}</div>;
}
