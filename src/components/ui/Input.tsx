import { InputHTMLAttributes, ReactNode, forwardRef } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  icon?: ReactNode;
  rightSlot?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, icon, rightSlot, className = "", id, ...props },
  ref
) {
  const inputId = id ?? props.name;
  return (
    <div>
      <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-foreground">
        {label}
      </label>
      <div className="relative">
        {icon && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
            {icon}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`w-full rounded-lg border border-border bg-surface py-2.5 text-sm text-foreground outline-none transition-shadow placeholder:text-muted/60 focus:border-accent focus:ring-2 focus:ring-accent/25 ${
            icon ? "pl-10" : "pl-3"
          } ${rightSlot ? "pr-10" : "pr-3"} ${className}`}
          {...props}
        />
        {rightSlot && <span className="absolute right-3 top-1/2 -translate-y-1/2">{rightSlot}</span>}
      </div>
    </div>
  );
});
