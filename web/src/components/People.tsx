// 看板上的收集进度和名单：只有名字、状态、公共集合点和通知有没有送到（隐私投影之后的数据）。

import type { OrganizerView } from "@shared/views";
import type { MemberStatus } from "@shared/types";
import { Icon, type IconName } from "./Icon";

type Member = OrganizerView["members"][number];
type Delivery = NonNullable<Member["delivery"]>;

const STATUS_LABEL: Record<MemberStatus, string> = {
  invited: "Invited",
  collecting: "Answering",
  confirmed: "Confirmed",
  declined: "Declined",
};

const DELIVERY: Record<Delivery, { icon: IconName; label: string }> = {
  sent: { icon: "check", label: "Plan sent" },
  failed: { icon: "alert", label: "Not delivered" },
  scheduled: { icon: "clock", label: "Scheduled" },
};

export function Progress({ counts }: { counts: OrganizerView["counts"] }) {
  const { total, confirmed, waiting } = counts;
  if (total === 0)
    return (
      <div className="progress">
        <p className="progress-count">No one's invited yet.</p>
      </div>
    );
  const declined = Math.max(total - confirmed - waiting, 0);
  const segments = [...segment(confirmed, "done"), ...segment(waiting, "open"), ...segment(declined, "out")];
  return (
    <div className="progress">
      <p className="progress-count">
        <span className="progress-big">
          {confirmed} of {total}
        </span>{" "}
        ready
        {waiting > 0 && <span className="progress-waiting"> · waiting on {waiting}</span>}
      </p>
      <div className="progress-bar" aria-hidden="true">
        {segments.map((item) => (
          <span key={item.key} className={`seg seg-${item.kind}`} />
        ))}
      </div>
    </div>
  );
}

function segment(length: number, kind: "done" | "open" | "out") {
  return Array.from({ length }, (_, index) => ({ key: `${kind}-${index}`, kind }));
}

export function MemberList({ members }: { members: Member[] }) {
  return (
    <ul className="members">
      {members.map((member) => (
        <li key={member.name} className="member">
          <p className="member-name">
            {member.name}
            {member.role === "organizer" && <span className="tag">Organizer</span>}
          </p>
          {/* 状态一变就重新挂载，播一次弹出动画：大屏上能看到谁刚确认。组织者不去时没有要收的答案 */}
          {member.role === "organizer" && !member.attending ? (
            <span className="chip chip-declined">Not attending</span>
          ) : (
            <StatusChip key={member.status} status={member.status} />
          )}
          {(member.pickup || member.delivery) && (
            <p className="member-meta">
              {member.pickup && <span>{member.pickup}</span>}
              {member.delivery && <DeliveryNote delivery={member.delivery} />}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

function StatusChip({ status }: { status: MemberStatus }) {
  return (
    <span className={`chip chip-${status}`}>
      <span className="chip-dot" aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}

function DeliveryNote({ delivery }: { delivery: Delivery }) {
  const { icon, label } = DELIVERY[delivery];
  return (
    <span className={`delivery delivery-${delivery}`}>
      <Icon name={icon} />
      {label}
    </span>
  );
}
