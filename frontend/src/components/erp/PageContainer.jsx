export default function PageContainer({ children, className = "" }) {
  return <div className={`p-6 lg:p-8 ${className}`.trim()}>{children}</div>;
}
