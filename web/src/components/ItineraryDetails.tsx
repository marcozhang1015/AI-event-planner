// 一个人自己的安排：改了什么、时间线（乘客：谁几点在哪接；司机：接人路线）、同车的人、费用上界。
// 个人行程页和组织者参加时的看板（compact）共用。

import type { ItineraryView } from "@shared/views";
import { activityDetail, costText, dinnerDetail, nameOf, sentence } from "../format";
import { Icon } from "./Icon";
import { Timeline, type TimelineEntry } from "./Timeline";

interface ItineraryDetailsProps {
  itinerary: ItineraryView;
  /** 看板上的精简版：不列同车的人（车组在方案里已经有了），"加入日历"是个小链接。 */
  compact?: boolean;
}

export function ItineraryDetails({ itinerary, compact = false }: ItineraryDetailsProps) {
  return (
    <div className={compact ? "itinerary itinerary-compact" : "itinerary"}>
      {itinerary.changes.length > 0 && (
        <section className="updated" aria-label="What changed">
          <p className="updated-label">
            <Icon name="update" />
            Updated
          </p>
          <ul>
            {itinerary.changes.map((change) => (
              <li key={change}>{sentence(change)}</li>
            ))}
          </ul>
        </section>
      )}
      <Timeline entries={itineraryEntries(itinerary)} label="Your day" />
      {!compact && itinerary.carmates.length > 0 && (
        <section className="carmates" aria-labelledby="carmates-heading">
          <h3 id="carmates-heading" className="label">
            In your car
          </h3>
          <ul>
            {itinerary.carmates.map(({ person, place }) => (
              <li key={person.name}>
                <span className="carmate-name">{nameOf(person)}</span>
                {/* PersonRef 没有 id，只能按名字认出司机 */}
                <span className="carmate-meta">{person.name === itinerary.driver.name ? "Driving" : place.name}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="itinerary-cost">
        <p className="cost">
          <span className="label">Your cost</span>
          <span className="cost-value">{costText(itinerary.costMaxCents)}</span>
        </p>
        {compact && (
          <a className="text-link" href={itinerary.calendarUrl}>
            <Icon name="calendar" />
            Add to calendar
          </a>
        )}
      </div>
    </div>
  );
}

function itineraryEntries(itinerary: ItineraryView): TimelineEntry[] {
  const { pickup, activity, dinner, dropoff } = itinerary;
  const start: TimelineEntry[] =
    itinerary.role === "driver"
      ? [
          { key: "leave", at: pickup.at, kind: "pickup", title: `Leave ${pickup.place.name}` },
          // route 的第一站是司机自己出发，后面才是沿路接的人
          ...itinerary.route
            .filter((stop) => !stop.person.me)
            .map((stop): TimelineEntry => ({ key: `stop-${stop.person.name}`, at: stop.at, kind: "stop", title: `Pick up ${stop.person.name}`, detail: stop.place.name })),
        ]
      : [{ key: "pickup", at: pickup.at, kind: "pickup", title: `${nameOf(itinerary.driver)} picks you up`, detail: pickup.place.name }];
  // returnRoute 的最后一站是司机自己到家，前面是沿路送的人
  const dropoffs = itinerary.returnRoute
    .filter((stop) => !stop.person.me)
    .map((stop): TimelineEntry => ({ key: `drop-${stop.person.name}`, at: stop.at, approx: true, kind: "stop", title: `Drop off ${stop.person.name}`, detail: stop.place.name }));
  return [
    ...start,
    { key: "activity", at: activity.start, kind: "activity", title: activity.venue.name, detail: activityDetail(activity) },
    { key: "dinner", at: dinner.start, kind: "restaurant", title: dinner.venue.name, detail: dinnerDetail(dinner), note: dinner.note },
    ...dropoffs,
    { key: "home", at: dropoff.at, approx: true, kind: "home", title: itinerary.role === "driver" ? "Home" : `Back at ${dropoff.place.name}` },
  ];
}
