// 页面顶部：活动标题、哪天几点、在哪；右上角显示数据是不是还在实时刷新。

import type { PublicEvent } from "@shared/views";
import { fmtMoney, fmtWindow } from "@shared/time";

interface MastheadProps {
  event: PublicEvent;
  kicker: string;
  live: boolean;
  /** 看板上显示组织者定的人均上限。 */
  showBudget?: boolean;
}

export function Masthead({ event, kicker, live, showBudget = false }: MastheadProps) {
  const when = [event.dayName, event.window && fmtWindow(event.window)].filter(Boolean).join(" · ");
  const budget = showBudget && event.budgetCapCents !== undefined && `up to ${fmtMoney(event.budgetCapCents)}/person`;
  const meta = [when, event.area, budget].filter(Boolean);
  return (
    <header className="masthead">
      <div className="masthead-top">
        <p className="kicker">Juno · {kicker}</p>
        <p className={live ? "live" : "live live-off"} role="status">
          <span className="live-dot" aria-hidden="true" />
          {live ? "Live" : "Reconnecting…"}
        </p>
      </div>
      <h1 className="masthead-title">{event.title}</h1>
      {meta.length > 0 && <p className="masthead-meta">{meta.join(" · ")}</p>}
    </header>
  );
}
