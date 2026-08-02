import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function SectionCard({ title, description, children, className = "" }) {
  return (
    <Card className={`border-slate-200 shadow-sm ${className}`.trim()}>
      {(title || description) ? (
        <CardHeader className="pb-3">
          {title ? <CardTitle className="text-lg font-semibold text-slate-900">{title}</CardTitle> : null}
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
      ) : null}
      <CardContent>{children}</CardContent>
    </Card>
  );
}
