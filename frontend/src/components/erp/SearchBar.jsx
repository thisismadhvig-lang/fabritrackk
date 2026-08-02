import { Input } from "@/components/ui/input";

export default function SearchBar({ value, onChange, placeholder = "Search", className = "" }) {
  return (
    <Input
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className={`h-10 w-full max-w-sm rounded-xl border-slate-200 bg-white ${className}`.trim()}
    />
  );
}
