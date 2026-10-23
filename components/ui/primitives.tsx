import * as React from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", type = "button", ...props }, ref) => {
    const variants: Record<NonNullable<ButtonProps["variant"]>, string> = {
      primary:
        "bg-[var(--brand)] text-[var(--brand-fg)] hover:opacity-95 shadow-xs border border-transparent",
      secondary:
        "bg-[var(--surface-muted)] text-[var(--fg)] hover:bg-[var(--border)] border border-[var(--border)]",
      outline:
        "bg-transparent text-[var(--fg)] hover:bg-[var(--surface-muted)] border border-[var(--border-strong)]",
      ghost:
        "bg-transparent text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-muted)] border border-transparent",
      danger:
        "bg-[var(--critical)] text-white hover:opacity-95 border border-transparent",
    };

    const sizes: Record<NonNullable<ButtonProps["size"]>, string> = {
      sm: "h-8 px-3 text-xs rounded-[8px] gap-1.5",
      md: "h-9 px-4 text-sm rounded-[8px] gap-2",
      lg: "h-11 px-5 text-base rounded-[12px] gap-2.5",
    };

    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          "inline-flex items-center justify-center font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none cursor-pointer",
          variants[variant],
          sizes[size],
          className,
        )}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-9 w-full rounded-[8px] border border-[var(--border-strong)] bg-[var(--bg)] px-3 py-1.5 text-sm text-[var(--fg)] placeholder:text-[var(--fg-subtle)] disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "min-h-[84px] w-full rounded-[8px] border border-[var(--border-strong)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--fg)] placeholder:text-[var(--fg-subtle)] disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "h-9 w-full rounded-[8px] border border-[var(--border-strong)] bg-[var(--bg)] px-3 py-1.5 text-sm text-[var(--fg)] disabled:opacity-50",
      className,
    )}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = "Select";

export function Card({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[12px] border border-[var(--border)] bg-[var(--surface-elevated)] p-5 shadow-[var(--shadow-soft)]",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function Badge({
  className,
  variant = "neutral",
  children,
}: {
  className?: string;
  variant?: "neutral" | "brand" | "good" | "warning" | "critical" | "info";
  children: React.ReactNode;
}) {
  const styles: Record<string, string> = {
    neutral: "bg-[var(--surface-muted)] text-[var(--fg-muted)] border-[var(--border)]",
    brand: "bg-[var(--brand-subtle)] text-[var(--brand)] border-[var(--brand-300)]",
    good: "bg-[var(--good-bg)] text-[var(--good)] border-[var(--good-border)]",
    warning: "bg-[var(--warning-bg)] text-[var(--warning)] border-[var(--warning-border)]",
    critical: "bg-[var(--critical-bg)] text-[var(--critical)] border-[var(--critical-border)]",
    info: "bg-[var(--info-bg)] text-[var(--info)] border-[var(--info-border)]",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        styles[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Accessibility rule: severity is NEVER shown by color alone — always icon + explicit label.
 */
export function SeverityBadge({
  severity,
  label,
}: {
  severity: "critical" | "warning" | "info" | "good";
  label?: string;
}) {
  const map = {
    critical: { Icon: AlertCircle, variant: "critical" as const, defaultText: "Critical" },
    warning: { Icon: AlertTriangle, variant: "warning" as const, defaultText: "Warning" },
    info: { Icon: Info, variant: "info" as const, defaultText: "Info" },
    good: { Icon: CheckCircle2, variant: "good" as const, defaultText: "Good" },
  };
  const { Icon, variant, defaultText } = map[severity];
  return (
    <Badge variant={variant}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{label ?? defaultText}</span>
    </Badge>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("animate-pulse rounded-[8px] bg-[var(--surface-muted)]", className)}
      aria-hidden="true"
    />
  );
}
