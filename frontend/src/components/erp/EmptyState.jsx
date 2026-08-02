export default function EmptyState({ title, description, children }) {
  return (
    <div className="rounded-[16px] border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
      {title ? <div className="text-base font-semibold text-slate-800">{title}</div> : null}
      {description ? <div className="mt-2 text-sm text-slate-600">{description}</div> : null}
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}
