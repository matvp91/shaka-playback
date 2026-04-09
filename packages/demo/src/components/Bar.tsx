import type { ReactNode } from "react";
import { twMerge } from "tailwind-merge";

type BarProps = {
  label: string;
  labelClassName?: string;
  children: ReactNode;
};

export function Bar({ label, labelClassName, children }: BarProps) {
  return (
    <div className="flex items-center gap-2">
      <span className={twMerge("w-20 text-right", labelClassName)}>
        {label}
      </span>
      {children}
    </div>
  );
}
