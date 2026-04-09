import type { ReactNode } from "react";
import { cn } from "../utils";

type BarProps = {
  label: string;
  labelClassName?: string;
  children: ReactNode;
};

export function Bar({ label, labelClassName, children }: BarProps) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn("w-20 text-right", labelClassName)}>{label}</span>
      {children}
    </div>
  );
}
