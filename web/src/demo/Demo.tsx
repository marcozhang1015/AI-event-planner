// 录屏页：白底、四部参与者手机。点击后按固定剧本播放，不连接 /sim。

import "../sim/simulator.css";
import "./demo.css";

import { Phone } from "../sim/Phone";
import { DEMO_FOCUS, DEMO_PEOPLE } from "./demoScript";
import { useDemoPlayback } from "./useDemoPlayback";

function noop() {}

export function Demo() {
  const demo = useDemoPlayback();
  const shown = demo.phase !== "idle";

  return (
    <div className={`demo ${demo.phase}${shown ? " shown" : ""}`} onClick={() => demo.phase === "idle" && demo.play()}>
      <header className="demo-top" key={`top-${demo.run}`}>
        <h1>Then, attendees got a private text from Juno...</h1>
        <p>They text Juno the details directly.</p>
      </header>

      <main className="demo-phones" key={`phones-${demo.run}`}>
        {DEMO_PEOPLE.map((person, index) => (
          <Phone
            key={person.id}
            person={person}
            index={index}
            items={demo.threads[person.id] ?? []}
            typing={demo.typing.includes(person.id)}
            fresh={demo.fresh}
            onSend={noop}
            onReact={noop}
            scripted
            scriptDraft={demo.drafts[person.id] ?? ""}
            composing={demo.composing.includes(person.id)}
            showHandle={false}
            focus={DEMO_FOCUS[person.id]}
          />
        ))}
      </main>

      {demo.phase === "complete" && (
        <div className="demo-cue complete">
          <button
            type="button"
            className="demo-replay"
            onClick={(event) => {
              event.stopPropagation();
              demo.replay();
            }}
          >
            Replay
          </button>
        </div>
      )}
    </div>
  );
}
