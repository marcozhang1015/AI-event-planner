// 录屏页：白底、四部参与者手机。点击后按固定剧本播放，不连接 /sim。

import "../sim/simulator.css";
import "./demo.css";

import { Phone } from "../sim/Phone";
import { DEMO_PEOPLE } from "./demoScript";
import { useDemoPlayback } from "./useDemoPlayback";

function noop() {}

export function Demo() {
  const demo = useDemoPlayback();

  return (
    <div className={`demo ${demo.phase}`} onClick={() => demo.phase === "idle" && demo.play()}>
      <header className="demo-top">
        <p className="demo-kicker">Juno</p>
        <h1>Four private chats.</h1>
        <p>One Saturday plan for hike and dinner. Each person texts on their own.</p>
      </header>

      <main className="demo-phones">
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
          />
        ))}
      </main>

      {demo.phase !== "playing" && (
        <div className={`demo-cue ${demo.phase}`}>
          {demo.phase === "idle" ? (
            <>
              <button
                type="button"
                className="demo-play"
                aria-label="Play"
                onClick={(event) => {
                  event.stopPropagation();
                  demo.play();
                }}
              >
                <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden>
                  <path fill="currentColor" d="M8.5 5.2v13.6L19.2 12z" />
                </svg>
              </button>
              <p className="demo-hint">Click anywhere to play</p>
            </>
          ) : (
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
          )}
        </div>
      )}
    </div>
  );
}
