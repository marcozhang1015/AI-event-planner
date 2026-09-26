// 时刻表式的竖向时间线：左边是等宽数字的时刻，中间一条线串起各站，标记形状和地图上的一致。

import { fmtTime } from "@shared/time";
import type { LocalTime } from "@shared/types";

/** stop：司机沿路接人；home：送到家。 */
export type StopKind = "pickup" | "stop" | "activity" | "restaurant" | "home";

export interface TimelineEntry {
  key: string;
  at: LocalTime;
  /** 估计的时刻（送到家），显示成 "~8:40 PM"。 */
  approx?: boolean;
  kind: StopKind;
  title: string;
  detail?: string;
  /** 需要留意的一句话，比如组织者核实过餐厅能处理过敏。 */
  note?: string;
}

export function Timeline({ entries, label }: { entries: TimelineEntry[]; label: string }) {
  return (
    <ol className="timeline" aria-label={label}>
      {entries.map((entry) => (
        <li key={entry.key} className={`tl tl-${entry.kind}`}>
          <time className="tl-time" dateTime={entry.at}>
            {entry.approx && "~"}
            {fmtTime(entry.at)}
          </time>
          <span className="tl-mark" aria-hidden="true" />
          <div className="tl-body">
            <p className="tl-title">{entry.title}</p>
            {entry.detail && <p className="tl-detail">{entry.detail}</p>}
            {entry.note && <p className="tl-note">{entry.note}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
