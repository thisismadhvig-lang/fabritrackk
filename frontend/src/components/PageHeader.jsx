export default function PageHeader({ title, subtitle, actions, testid }) {
  return (
    <div
      data-testid={testid || "page-header"}
      className="flex items-start justify-between mb-6 pb-4 border-b border-slate-200"
    >
      <div>
        <div className="label-caps mb-1.5">Operations</div>
        <h1 className="font-heading text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
          {title}
        </h1>
        {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
