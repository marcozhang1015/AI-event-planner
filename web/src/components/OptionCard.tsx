// 方案里的一个选项（Plan A / B）：状态、批准前要处理的事、时间线、车组、这次去不了的人。
// 待核实项只说哪家店、什么过敏，不说是谁（视图里本来就没有）。

import { allergyPhrase, EXCLUSION_LABELS } from "@shared/labels";
import { fmtMoney, fmtTime } from "@shared/time";
import type { OptionView, RideView, UnknownView } from "@shared/views";
import { activityDetail, carOf, count, dinnerDetail, listOf, nameInSentence, nameOf, telHref } from "../format";
import { Badge } from "./Badge";
import { Icon } from "./Icon";
import { routeStyle } from "./map/model";
import { RouteSwatch } from "./map/MapView";
import { Timeline, type TimelineEntry } from "./Timeline";

interface OptionCardProps {
  option: OptionView;
  /** 已发布的就是这个选项。 */
  published: boolean;
  /** 地图上画的是这个选项的路线：车组前面画上对应的线型。 */
  onMap: boolean;
}

export function OptionCard({ option, published, onMap }: OptionCardProps) {
  const titleId = `plan-${option.label}`;
  return (
    <article className="option" aria-labelledby={titleId}>
      <header className="option-head">
        <h3 id={titleId} className="option-title">
          Plan {option.label} <span>· {count(option.attendees.length, "person", "people")}</span>
        </h3>
        <p className="option-meta">
          {!published && <OptionBadge option={option} />}
          <span className="option-cost">Up to {fmtMoney(option.costMaxCents)} each</span>
        </p>
      </header>
      {option.unknowns.length > 0 && <Unknowns unknowns={option.unknowns} />}
      {option.waitingOn.length > 0 && (
        <p className="waiting">
          <Icon name="clock" />
          Waiting on {listOf(option.waitingOn.map(nameInSentence))} to confirm driving
        </p>
      )}
      <div className="option-body">
        <Timeline entries={optionEntries(option)} label={`Plan ${option.label} timeline`} />
        <Rides rides={option.rides} onMap={onMap} />
      </div>
      {option.excluded.length > 0 && (
        <div className="excluded">
          <h4 className="label">Sitting out</h4>
          <ul>
            {option.excluded.map(({ person, reason }) => (
              <li key={person.name}>
                {nameOf(person)} <span>· {EXCLUSION_LABELS[reason]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

/** 批准会被拦下的情况（待核实、在等司机答复）优先说。 */
function OptionBadge({ option }: { option: OptionView }) {
  if (option.status === "NEEDS_VERIFICATION")
    return (
      <Badge tone="attention" icon="alert">
        Needs a quick check
      </Badge>
    );
  if (option.waitingOn.length > 0)
    return (
      <Badge tone="attention" icon="clock">
        Waiting on a driver
      </Badge>
    );
  return (
    <Badge tone="done" icon="check">
      Ready to approve
    </Badge>
  );
}

function optionEntries(option: OptionView): TimelineEntry[] {
  const { activity, dinner } = option;
  return [
    { key: "pickup", at: option.firstPickup, kind: "pickup", title: "First pickup" },
    { key: "activity", at: activity.start, kind: "activity", title: activity.venue.name, detail: activityDetail(activity) },
    { key: "dinner", at: dinner.start, kind: "restaurant", title: dinner.venue.name, detail: dinnerDetail(dinner) },
    { key: "home", at: option.lastDropoff, kind: "home", title: "Everyone home" },
  ];
}

function Unknowns({ unknowns }: { unknowns: UnknownView[] }) {
  return (
    <div className="callout">
      <p className="callout-label">
        <Icon name="alert" />
        Check first
      </p>
      <ul>
        {unknowns.map((unknown) => (
          <li key={`${unknown.venue}-${unknown.fact}`}>
            Can {unknown.venue} handle {allergyPhrase(unknown.fact, unknown.severe)}?
            {unknown.phone && (
              <>
                {" "}
                Call <a href={telHref(unknown.phone)}>{unknown.phone}</a>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}


function Rides({ rides, onMap }: { rides: RideView[]; onMap: boolean }) {
  return (
    <div className="rides">
      <h4 className="label">Rides</h4>
      <ul>
        {rides.map((ride, index) => (
          <li key={ride.driver.name} className="ride">
            <p className="ride-who">
              {onMap && <RouteSwatch style={routeStyle(index)} />}
              <span className="sr-only">{carOf(ride.driver)}: </span>
              <span aria-hidden="true">{nameOf(ride.driver)} → </span>
              {ride.passengers.length ? ride.passengers.map(nameOf).join(", ") : "no passengers"}
            </p>
            <ol className="ride-stops">
              {ride.pickups.map((stop) => (
                <li key={stop.person.name}>
                  <time dateTime={stop.at}>{fmtTime(stop.at)}</time>
                  <span>{stop.place.name}</span>
                  <span className="ride-person">{nameOf(stop.person)}</span>
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ul>
    </div>
  );
}
