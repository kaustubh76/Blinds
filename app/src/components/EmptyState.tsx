import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

/** One sentence about what will appear here, and — when there is one — the action that makes it. */
export function EmptyState({
  icon = "clock",
  title,
  children,
  action,
}: {
  icon?: IconName;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-[var(--radius-md)] border border-dashed border-line px-4 py-5">
      <div className="flex items-center gap-2 text-sm text-ink-1">
        <Icon name={icon} size={14} className="text-ink-3" />
        {title}
      </div>
      {children && <p className="text-xs leading-relaxed text-ink-3">{children}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
