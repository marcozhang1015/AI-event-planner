// 组织者看板（/o/:token）：收集进度、方案、地图。demo 时投在大屏上（1920×1080），也要能在手机上看。
// 只读：所有决定都在 iMessage 里做，页脚提示下一步该回什么。

import type { ItineraryView, OrganizerView, PlanView } from "@shared/views";
import { ItineraryDetails } from "../components/ItineraryDetails";
import { MapView } from "../components/map/MapView";
import { Masthead } from "../components/Masthead";
import { MemberList, Progress } from "../components/People";
import { featuredOption, PlanPanel } from "../components/PlanPanel";
import { listOf, nameInSentence } from "../format";

export function OrganizerPage({ view, live }: { view: OrganizerView; live: boolean }) {
  const option = view.plan && featuredOption(view.plan);
  const hasMap = Boolean(option || view.pins.length || view.mapImage);
  return (
    <div className="juno dash">
      <Masthead event={view.event} kicker="Organizer dashboard" live={live} showBudget />
      <main className="dash-main">
        <section className="dash-people" aria-labelledby="people-heading">
          <h2 id="people-heading" className="label section-label">
            People
          </h2>
          <Progress counts={view.counts} />
          <MemberList members={view.members} />
        </section>
        <section className="dash-plan" aria-labelledby="plan-heading">
          <PlanPanel headingId="plan-heading" plan={view.plan} counts={view.counts} aggregates={view.aggregates} />
          {view.me && <YourDay itinerary={view.me} />}
        </section>
        <section className="dash-map" aria-labelledby="map-heading">
          <h2 id="map-heading" className="label section-label">
            {option ? `Routes · Plan ${option.label}` : "Map"}
          </h2>
          {/* 出了方案只画这个选项的路线；收集阶段画集合点和候选场地 */}
          {hasMap ? (
            <MapView pins={option ? undefined : view.pins} option={option} imageUrl={view.mapImage} />
          ) : (
            <p className="map-empty">Pickup spots show up here as people answer.</p>
          )}
        </section>
      </main>
      <footer className="foot">
        <NextStep plan={view.plan} />
      </footer>
    </div>
  );
}

/** 组织者也去、方案已发布时，他自己的那份。 */
function YourDay({ itinerary }: { itinerary: ItineraryView }) {
  return (
    <section className="your-day" aria-labelledby="your-day-heading">
      <h2 id="your-day-heading" className="label section-label">
        Your day
      </h2>
      <ItineraryDetails itinerary={itinerary} compact />
    </section>
  );
}

function NextStep({ plan }: { plan?: PlanView }) {
  const lead = "Everything is decided in iMessage — ";
  if (!plan) return <p>{lead}Juno texts you the plan once everyone's in.</p>;
  if (plan.status === "INFEASIBLE") return <p>{lead}tell Juno there what to change.</p>;
  if (plan.state === "live") return <p>{lead}tell Juno there if anything changes.</p>;
  const [a] = plan.options;
  if (a?.waitingOn.length) return <p>{lead}Juno is checking with {listOf(a.waitingOn.map(nameInSentence))} about driving first.</p>;
  if (a?.status === "NEEDS_VERIFICATION" && plan.options.length === 1)
    return <p>{lead}call {a.unknowns[0]?.venue ?? "the restaurant"} first, then tell Juno what they said.</p>;
  const replies = plan.state === "update" ? ["approve"] : plan.options.map((option) => `approve ${option.label}`);
  return (
    <p>
      {lead}reply{" "}
      {replies.map((reply, index) => (
        <span key={reply}>
          {index > 0 && " or "}
          <code>{reply}</code>
        </span>
      ))}{" "}
      to Juno there.
    </p>
  );
}
