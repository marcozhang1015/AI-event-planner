import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { SimItem } from "@shared/sim";
import { DEMO_CUES, DEMO_DURATION_MS, DEMO_PEOPLE, type DemoCue } from "./demoScript";

export type DemoPhase = "idle" | "playing" | "complete";

interface Visual {
  threads: Record<string, SimItem[]>;
  typing: string[];
  drafts: Record<string, string>;
  composing: string[];
  seq: number;
}

interface State {
  phase: DemoPhase;
  visual: Visual;
}

type Action = { type: "reset" } | { type: "phase"; phase: DemoPhase } | { type: "cues"; cues: DemoCue[] };

function blank(): Visual {
  return {
    threads: Object.fromEntries(DEMO_PEOPLE.map((person) => [person.id, []])),
    typing: [],
    drafts: Object.fromEntries(DEMO_PEOPLE.map((person) => [person.id, ""])),
    composing: [],
    seq: 0,
  };
}

function withPerson(list: string[], person: string, on: boolean): string[] {
  if (on) return list.includes(person) ? list : [...list, person];
  return list.filter((id) => id !== person);
}

function apply(visual: Visual, cue: DemoCue): Visual {
  const person = cue.person;
  if (cue.type === "typing") return { ...visual, typing: withPerson(visual.typing, person, Boolean(cue.on)) };
  if (cue.type === "compose") return { ...visual, composing: withPerson(visual.composing, person, Boolean(cue.on)) };
  if (cue.type === "draft") return { ...visual, drafts: { ...visual.drafts, [person]: cue.text ?? "" } };
  const item: SimItem = {
    id: `demo-${person}-${visual.seq}`,
    from: cue.type === "agent" ? "agent" : "user",
    kind: "text",
    text: cue.text ?? "",
    at: new Date(Date.UTC(2026, 8, 26, 14, 41, 0) + cue.at).toISOString(),
    reactions: [],
  };
  return {
    ...visual,
    seq: visual.seq + 1,
    drafts: cue.type === "send" ? { ...visual.drafts, [person]: "" } : visual.drafts,
    threads: { ...visual.threads, [person]: [...(visual.threads[person] ?? []), item] },
  };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "reset":
      return { ...state, visual: blank() };
    case "phase":
      return { ...state, phase: action.phase };
    case "cues": {
      let visual = state.visual;
      for (const cue of action.cues) visual = apply(visual, cue);
      return visual === state.visual ? state : { ...state, visual };
    }
  }
}

/** 点击后按剧本播放；Replay 会清空并从头再来。计时器在卸载或重播时全部取消。 */
export function useDemoPlayback() {
  const [state, dispatch] = useReducer(reducer, { phase: "idle", visual: blank() });
  const [run, setRun] = useReducer((value: number) => value + 1, 0);
  const lock = useRef(false);

  useEffect(() => {
    if (state.phase !== "playing") {
      lock.current = false;
      return;
    }
    let cursor = 0;
    let frame = 0;
    let closed = false;
    const started = performance.now();
    const tick = (now: number) => {
      if (closed) return;
      const elapsed = now - started;
      const batch: DemoCue[] = [];
      while (cursor < DEMO_CUES.length) {
        const cue = DEMO_CUES[cursor];
        if (!cue || cue.at > elapsed) break;
        batch.push(cue);
        cursor += 1;
      }
      if (batch.length) dispatch({ type: "cues", cues: batch });
      if (elapsed >= DEMO_DURATION_MS && cursor >= DEMO_CUES.length) {
        dispatch({ type: "phase", phase: "complete" });
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      closed = true;
      cancelAnimationFrame(frame);
    };
  }, [state.phase, run]);

  const start = useCallback(() => {
    if (lock.current) return;
    lock.current = true;
    dispatch({ type: "reset" });
    dispatch({ type: "phase", phase: "playing" });
    setRun();
  }, []);

  const play = useCallback(() => {
    if (state.phase !== "idle") return;
    start();
  }, [state.phase, start]);

  const replay = useCallback(() => {
    if (state.phase !== "complete") return;
    start();
  }, [state.phase, start]);

  const fresh = useMemo(() => new Set(Object.values(state.visual.threads).flat().map((item) => item.id)), [state.visual.threads]);

  return { phase: state.phase, ...state.visual, fresh, play, replay };
}
