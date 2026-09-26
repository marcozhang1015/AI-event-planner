// 网页模拟器：暗色舞台上一排发光的 iPhone，每部是一个人和 Juno 的私聊。
// 头顶的灯 = Juno 正在给这个人打字，直观看到"一个 agent 同时私聊很多人"。

import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "@fontsource/martian-mono/400.css";
import "@fontsource/martian-mono/600.css";
import "./simulator.css";

import { useEffect, useState, type CSSProperties } from "react";
import { Phone } from "./Phone";
import { useSim, type SimStatus } from "./useSim";

const STATUS_LABEL: Record<SimStatus, string> = { connecting: "Connecting", live: "Live", offline: "Reconnecting" };

function loadHidden(): string[] {
  try {
    return JSON.parse(localStorage.getItem("sim.hidden") ?? "[]") as string[];
  } catch {
    return [];
  }
}

export function Simulator() {
  const sim = useSim();
  const [hidden, setHidden] = useState<string[]>(loadHidden);

  useEffect(() => {
    localStorage.setItem("sim.hidden", JSON.stringify(hidden));
  }, [hidden]);

  const visible = sim.people.filter((person) => !hidden.includes(person.id));
  const active = sim.typing.filter((person) => visible.some((p) => p.id === person)).length;
  const toggle = (id: string) => setHidden((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));

  return (
    <div className="sim" style={{ "--count": Math.max(visible.length, 1) } as CSSProperties}>
      <header className="sim-top">
        <div className="sim-title">
          <p className="kicker">Juno simulator · Spectrum provider “sim” · runs alongside iMessage</p>
          <h1>
            One agent. <em>{visible.length === 1 ? "One private chat." : `${visible.length} private chats.`}</em>
          </h1>
        </div>
        <div className="sim-controls">
          <span className={`status ${sim.status}`}>
            <span className="dot" aria-hidden />
            {STATUS_LABEL[sim.status]}
            {sim.status === "live" && active > 0 && <span className="status-note">· typing to {active}</span>}
          </span>
          <div className="chips" role="group" aria-label="Show or hide phones">
            {sim.people.map((person) => (
              <button key={person.id} type="button" className="chip" aria-pressed={!hidden.includes(person.id)} onClick={() => toggle(person.id)}>
                {person.name}
              </button>
            ))}
          </div>
        </div>
      </header>

      {sim.status === "live" && sim.people.length === 0 ? (
        <p className="sim-empty">
          No simulated people yet. Add names with <code>sim:</code> handles to <code>fixtures/contacts.json</code>, then restart the server.
        </p>
      ) : (
        <main className="stage">
          {visible.map((person, index) => (
            <Phone
              key={person.id}
              person={person}
              index={index}
              items={sim.threads[person.id] ?? []}
              typing={sim.typing.includes(person.id)}
              fresh={sim.fresh}
              onSend={(text) => sim.send(person.id, text)}
              onReact={(targetId, emoji) => sim.react(person.id, targetId, emoji)}
            />
          ))}
        </main>
      )}

      <footer className="sim-foot">
        <span>Tap a Juno bubble to react</span>
        <span>Links open the live dashboard</span>
        <span>Mix with real iPhones: PROVIDERS=imessage,sim</span>
      </footer>
    </div>
  );
}
