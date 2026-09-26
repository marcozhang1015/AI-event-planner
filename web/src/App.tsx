// 组织者看板（/o/:token）和个人行程页（/i/:token），只读（§5.6）。
// 骨架版只把数据显示出来；地图、时间线、车组路线由 A 在 M2–M3 补上。

import { lazy, Suspense, useEffect, useState } from "react";
import type { AttendeeView, MapPin, OrganizerView, PublicEvent } from "../../src/api/dto";
import { fmtMoney, fmtTime, fmtWindow } from "../../src/core/time";

type View = OrganizerView | AttendeeView;

const POLL_MS = 2500;

function usePolling(path: string | undefined) {
  const [view, setView] = useState<View>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!path) return;
    let alive = true;
    const load = async () => {
      try {
        const response = await fetch(path);
        if (!response.ok) throw new Error(response.status === 404 ? "This link doesn't exist." : `HTTP ${response.status}`);
        const data = (await response.json()) as View;
        if (alive) {
          setView(data);
          setError(undefined);
        }
      } catch (caught) {
        if (alive) setError(caught instanceof Error ? caught.message : String(caught));
      }
    };
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [path]);

  return { view, error };
}

function EventHeader({ event }: { event: PublicEvent }) {
  const when = [event.dayName, event.window && fmtWindow(event.window)].filter(Boolean).join(" · ");
  return (
    <header>
      <h1>{event.title}</h1>
      <p className="muted">
        {[when, event.area, event.budgetCapCents !== undefined && `up to ${fmtMoney(event.budgetCapCents)}/person`].filter(Boolean).join(" · ")}
      </p>
    </header>
  );
}

function Pins({ pins }: { pins: MapPin[] }) {
  if (!pins.length) return null;
  // TODO(A, M2)：换成 Maps JavaScript API 的地图（浏览器 key 按域名限制）
  return (
    <section>
      <h2>On the map</h2>
      <ul>
        {pins.map((pin) => (
          <li key={pin.id}>
            {pin.name} <span className="muted">({pin.kind})</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Raw({ view }: { view: View }) {
  return (
    <details>
      <summary className="muted">Raw data</summary>
      <pre>{JSON.stringify(view, null, 2)}</pre>
    </details>
  );
}

function OrganizerPage({ view }: { view: OrganizerView }) {
  const { counts, aggregates } = view;
  return (
    <main className="page">
      <EventHeader event={view.event} />
      <p>
        <strong>
          {counts.confirmed} of {counts.total} ready
        </strong>
        {counts.waiting > 0 && <span className="muted"> · waiting on {counts.waiting}</span>}
      </p>
      <section>
        <h2>People</h2>
        <ul>
          {view.members.map((member) => (
            <li key={member.name}>
              {member.name} <span className="muted">— {member.role === "organizer" ? "organizer" : member.status}</span>
              {member.pickup && <span className="muted"> · pickup at {member.pickup}</span>}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2>So far</h2>
        <ul>
          <li>
            {aggregates.drivers} driving · {aggregates.seats} seats · {aggregates.needRides} need a ride
          </li>
          {aggregates.allergies.length > 0 && <li>Allergies to plan around: {aggregates.allergies.join(", ")}</li>}
        </ul>
      </section>
      <Pins pins={view.pins} />
      <p className="muted">Everything is decided in iMessage — reply to Juno there.</p>
      <Raw view={view} />
    </main>
  );
}

function AttendeePage({ view }: { view: AttendeeView }) {
  const { answer } = view.me;
  return (
    <main className="page">
      <EventHeader event={view.event} />
      <p>
        Hi {view.me.name} — {view.organizerName} is organizing.{" "}
        {answer.confirmed ? "You're all set; I'll text you once the plan is ready." : "I'm still collecting your details in iMessage."}
      </p>
      <section>
        <h2>What you told me</h2>
        <ul>
          {answer.free && <li>Free {answer.free.map(fmtWindow).join(", ")}</li>}
          {answer.homeBy && <li>Home by {fmtTime(answer.homeBy)}</li>}
          {answer.allergies && <li>{answer.allergies.length ? `Allergies: ${answer.allergies.join(", ")}` : "No food allergies"}</li>}
          {answer.drives && <li>{answer.drives === "no" ? "Needs a ride" : `Driving${answer.seats !== undefined ? `, ${answer.seats} seats` : ""}`}</li>}
          {answer.pickup && <li>Pickup at {answer.pickup}</li>}
          {answer.budgetCapCents !== undefined && <li>Budget up to {fmtMoney(answer.budgetCapCents)}</li>}
        </ul>
      </section>
      <Pins pins={view.pins} />
      <Raw view={view} />
    </main>
  );
}

// 模拟器单独打包，看板和个人页不用加载它的字体和样式
const Simulator = lazy(() => import("./sim/Simulator").then((module) => ({ default: module.Simulator })));

export function App() {
  if (window.location.pathname === "/sim")
    return (
      <Suspense fallback={null}>
        <Simulator />
      </Suspense>
    );
  return <Dashboard />;
}

function Dashboard() {
  const match = window.location.pathname.match(/^\/(o|i)\/([\w-]+)/);
  const path = match ? `/api/${match[1]}/${match[2]}` : undefined;
  const { view, error } = usePolling(path);

  if (!path)
    return (
      <main className="page">
        <h1>Juno</h1>
        <p>Open the link Juno sent you in iMessage.</p>
      </main>
    );
  if (!view) return <main className="page">{error ? <p>{error}</p> : <p className="muted">Loading…</p>}</main>;
  return view.role === "organizer" ? <OrganizerPage view={view} /> : <AttendeePage view={view} />;
}
