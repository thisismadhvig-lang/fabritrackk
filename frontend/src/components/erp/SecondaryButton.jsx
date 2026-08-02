import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function SecondaryButton({ className, children, ...props }) {
  return (
    <Button variant="outline" className={cn("border-slate-200 bg-white text-slate-700 hover:bg-slate-50", className)} {...props}>
      {children}
    </Button>
  );
}
