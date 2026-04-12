import type { ReactNode } from "react";

type BarProps = {
  label: string;
  children: ReactNode;
};

export function Bar({ label, children }: BarProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 text-right">{label}</span>
      {children}
    </div>
  );
}
