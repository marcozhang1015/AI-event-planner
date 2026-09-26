// 状态徽章：attention 是要组织者处理的（朱红），done 是已经没问题的（墨色）。

import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

interface BadgeProps {
  tone: "attention" | "done";
  icon: IconName;
  children: ReactNode;
}

export function Badge({ tone, icon, children }: BadgeProps) {
  return (
    <span className={`badge badge-${tone}`}>
      <Icon name={icon} />
      {children}
    </span>
  );
}
