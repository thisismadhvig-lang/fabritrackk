import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function PrimaryButton({ className, children, ...props }) {
  return (
    <Button className={cn("bg-slate-900 text-white hover:bg-slate-800", className)} {...props}>
      {children}
    </Button>
  );
}
