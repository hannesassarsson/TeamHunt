import { cloneElement, forwardRef, isValidElement, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const field = "w-full rounded-lg border border-border bg-surface px-3 text-sm text-text placeholder:text-muted/70 focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/25 disabled:opacity-60";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} className={cn(field, "h-10", className)} {...p} />
));
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={cn(field, "min-h-20 py-2", className)} {...p} />
));
Textarea.displayName = "Textarea";

/** Native select: best ergonomics on phones in the field. */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...p }, ref) => (
  <select ref={ref} className={cn(field, "h-10 appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23888%22 stroke-width=%222%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-[length:12px] bg-[right_0.75rem_center] bg-no-repeat pr-8", className)} {...p}>
    {children}
  </select>
));
Select.displayName = "Select";

const LABELABLE = new Set(["input", "select", "textarea"]);

/**
 * Form field with label, hint and error. When the child is a single form control (native or one
 * of our Input/Select/Textarea/SpeciesSelect wrappers) the label is associated automatically.
 */
export function Field({ label, hint, error, children, className, htmlFor }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string; htmlFor?: string }) {
  const auto = useId();
  const hintId = `${auto}-hint`;
  let control = children;
  let forId = htmlFor;
  if (!forId && isValidElement<{ id?: string; "aria-describedby"?: string }>(children)) {
    const t = children.type;
    const isControl = typeof t === "string" ? LABELABLE.has(t) : true;
    if (isControl) {
      forId = children.props.id ?? auto;
      control = cloneElement(children, { id: forId, "aria-describedby": hint || error ? hintId : undefined });
    }
  }
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={forId} className="block text-xs font-medium text-muted">{label}</label>
      {control}
      {error ? <p id={hintId} className="text-xs text-danger" role="alert">{error}</p> : hint ? <p id={hintId} className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function Checkbox({ label, className, ...p }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={cn("flex cursor-pointer items-center gap-2 text-sm", className)}>
      <input type="checkbox" className="size-4 rounded border-border accent-[var(--primary)]" {...p} />
      {label}
    </label>
  );
}
