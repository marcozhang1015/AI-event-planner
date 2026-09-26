// 个人行程页（/i/:token），手机优先：大家从 iMessage 里点开。
// 三种情况：方案还没发布（你告诉我的）、已发布（自己的行程）、这次被排除（一句友好的说明，不给方案细节）。

import type { AttendeeView, ItineraryView } from "@shared/views";
import type { ExclusionReason } from "@shared/types";
import { Answers } from "../components/Answers";
import { Icon } from "../components/Icon";
import { ItineraryDetails } from "../components/ItineraryDetails";
import { MapView } from "../components/map/MapView";
import { Masthead } from "../components/Masthead";
import { EXCLUSION_NOTE } from "../format";

export function ItineraryPage({ view, live }: { view: AttendeeView; live: boolean }) {
  return (
    <div className="juno trip">
      <Masthead event={view.event} kicker="Your plan" live={live} />
      <main className="trip-main">
        {view.itinerary ? (
          <Published view={view} itinerary={view.itinerary} />
        ) : view.excluded ? (
          <Excluded name={view.me.name} reason={view.excluded} />
        ) : (
          <BeforePlan view={view} />
        )}
      </main>
    </div>
  );
}

function Published({ view, itinerary }: { view: AttendeeView; itinerary: ItineraryView }) {
  return (
    <>
      <section className="trip-hero" aria-labelledby="hero-heading">
        <h2 id="hero-heading" className="headline">
          You're all set
          {view.event.dayName && (
            <>
              {" "}
              for <em>{view.event.dayName}</em>
            </>
          )}
        </h2>
        <a className="button" href={itinerary.calendarUrl}>
          <Icon name="calendar" />
          Add to calendar
        </a>
      </section>
      <ItineraryDetails itinerary={itinerary} />
      <section aria-labelledby="route-heading">
        <h3 id="route-heading" className="label section-label">
          Your route
        </h3>
        <MapView itinerary={itinerary} imageUrl={view.mapImage} />
      </section>
    </>
  );
}

function BeforePlan({ view }: { view: AttendeeView }) {
  const { me, organizerName } = view;
  return (
    <>
      <section className="trip-hero" aria-labelledby="hero-heading">
        <h2 id="hero-heading" className="headline">
          Hi {me.name} — <em>{organizerName}</em> is organizing.
        </h2>
        <p className="lede">{statusLine(me)}</p>
      </section>
      <Answers answer={me.answer} />
      {view.pins.length > 0 && (
        <section aria-labelledby="pins-heading">
          <h3 id="pins-heading" className="label section-label">
            On the map
          </h3>
          <MapView pins={view.pins} imageUrl={view.mapImage} />
        </section>
      )}
    </>
  );
}

function statusLine(me: AttendeeView["me"]): string {
  if (me.status === "declined") return "You told me you can't make this one.";
  if (!me.answer.confirmed) return "I'm still collecting your details in iMessage.";
  return me.hasEmail ? "I'll text you once the plan is set — and email you a calendar invite." : "I'll text you once the plan is set.";
}

function Excluded({ name, reason }: { name: string; reason: ExclusionReason }) {
  return (
    <section className="trip-hero" aria-labelledby="hero-heading">
      <h2 id="hero-heading" className="headline">
        Sorry, {name} — this one didn't fit.
      </h2>
      <p className="lede">{EXCLUSION_NOTE[reason]} I'll text you if anything changes.</p>
    </section>
  );
}
