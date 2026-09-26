// 看板上的方案区：方案状态和版本号、发布后的变更提议、排不出方案时的冲突、各个选项。
// 还没有方案时显示收集阶段的汇总（不带名字）。

import type { OptionView, OrganizerView, PersonRef, PlanView } from "@shared/views";
import { count, listOf, nameOf, sentence } from "../format";
import { Badge } from "./Badge";
import { Icon } from "./Icon";
import { OptionCard } from "./OptionCard";

function publishedOption(plan: PlanView): OptionView | undefined {
  return plan.state === "live" ? plan.options.find((option) => option.label === plan.publishedLabel) : undefined;
}

/** 地图上画哪个选项：发布了就是发布的那个，否则是 Plan A。 */
export function featuredOption(plan: PlanView): OptionView | undefined {
  return publishedOption(plan) ?? plan.options[0];
}

interface PlanPanelProps {
  /** 栏目标题的 id（外面的 section 用它做 aria-labelledby）。 */
  headingId: string;
  plan?: PlanView;
  counts: OrganizerView["counts"];
  aggregates: OrganizerView["aggregates"];
}

export function PlanPanel({ headingId, plan, counts, aggregates }: PlanPanelProps) {
  return (
    <>
      {/* 状态和版本号放在栏目标题同一行，投影上省出一行高度 */}
      <header className="plan-head">
        <h2 id={headingId} className="label section-label">
          The plan
        </h2>
        {plan && (
          <>
            <PlanBadge key={`${plan.id}-${plan.state}`} plan={plan} />
            <span className="version">v{plan.version}</span>
          </>
        )}
      </header>
      {plan ? <PlanBody plan={plan} /> : <PlanPending counts={counts} aggregates={aggregates} />}
    </>
  );
}

function PlanBody({ plan }: { plan: PlanView }) {
  const published = publishedOption(plan);
  const featured = published ?? plan.options[0];
  // 发布之后只看生效的那个选项；发布后的变更只批准 Plan A（回 "approve"），也只列 A
  const options = published ? [published] : plan.state === "update" ? plan.options.slice(0, 1) : plan.options;
  return (
    // 换了一版方案（id 变了）就整块重新挂载、重播进场动画，大屏上看得出来
    <div key={plan.id} className="plan">
      {plan.state === "update" && <ChangeSummary changes={plan.changes ?? []} affected={plan.affected ?? []} unaffected={plan.unaffected ?? []} />}
      {plan.status === "INFEASIBLE" && <Conflicts conflicts={plan.conflicts} />}
      {options.length > 0 && (
        <div className="options">
          {options.map((option) => (
            <OptionCard key={option.label} option={option} published={option === published} onMap={option === featured} />
          ))}
        </div>
      )}
    </div>
  );
}

function PlanBadge({ plan }: { plan: PlanView }) {
  if (plan.status === "INFEASIBLE")
    return (
      <Badge tone="attention" icon="alert">
        No plan works yet
      </Badge>
    );
  if (plan.state === "live")
    return (
      <Badge tone="done" icon="check">
        Published{plan.publishedLabel && ` · Plan ${plan.publishedLabel}`}
      </Badge>
    );
  if (plan.state === "update")
    return (
      <Badge tone="attention" icon="update">
        Update waiting for approval
      </Badge>
    );
  return (
    <Badge tone="attention" icon="clock">
      Needs your OK
    </Badge>
  );
}

function ChangeSummary({ changes, affected, unaffected }: { changes: string[]; affected: PersonRef[]; unaffected: PersonRef[] }) {
  return (
    <section className="changes" aria-label="Proposed change">
      <p className="label">What changes</p>
      <ul className="changes-list">
        {changes.map((change) => (
          <li key={change}>{sentence(change)}</li>
        ))}
      </ul>
      {(affected.length > 0 || unaffected.length > 0) && (
        <dl className="changes-who">
          {affected.length > 0 && (
            <div>
              <dt>Affected</dt>
              <dd>{affected.map(nameOf).join(", ")}</dd>
            </div>
          )}
          {unaffected.length > 0 && (
            <div>
              <dt>Not affected</dt>
              <dd>{unaffected.map(nameOf).join(", ")}</dd>
            </div>
          )}
        </dl>
      )}
    </section>
  );
}

function Conflicts({ conflicts }: { conflicts: string[] }) {
  return (
    <div className="callout">
      <p className="callout-label">
        <Icon name="alert" />
        What's in the way
      </p>
      <ul>
        {conflicts.map((conflict) => (
          <li key={conflict}>{conflict}</li>
        ))}
      </ul>
    </div>
  );
}

/** 收集阶段：还在等几个人，以及目前的汇总（能开车的人、空座、要搭车的人、要避开的过敏原）。 */
function PlanPending({ counts, aggregates }: Pick<PlanPanelProps, "counts" | "aggregates">) {
  if (counts.total === 0)
    return (
      <div className="plan-pending">
        <p className="pending-title">Nothing to plan yet.</p>
        <p className="pending-note">Tell Juno who's coming in iMessage — share contacts or just type names.</p>
      </div>
    );
  const everyoneIn = counts.waiting === 0;
  return (
    <div className="plan-pending">
      <p className="pending-title">{everyoneIn ? "Everyone's in." : `Waiting on ${count(counts.waiting, "person", "people")}.`}</p>
      <p className="pending-note">
        {everyoneIn ? (
          "Putting the plan together…"
        ) : (
          <>
            Juno puts the plan together once everyone has answered — or text <code>plan it</code> to start now.
          </>
        )}
      </p>
      <dl className="stats">
        <div>
          <dt>Can drive</dt>
          <dd>{aggregates.drivers}</dd>
        </div>
        <div>
          <dt>Spare seats</dt>
          <dd>{aggregates.seats}</dd>
        </div>
        <div>
          <dt>Need a ride</dt>
          <dd>{aggregates.needRides}</dd>
        </div>
      </dl>
      {aggregates.allergies.length > 0 && (
        <p className="pending-allergies">
          <span className="label">Plan around</span> {listOf(aggregates.allergies)}
        </p>
      )}
    </div>
  );
}
