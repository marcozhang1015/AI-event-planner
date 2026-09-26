import { useCallback, useEffect, useReducer, useRef } from "react";
import type { SimClientEvent, SimItem, SimPerson, SimServerEvent } from "../../../src/sim/protocol";

export type SimStatus = "connecting" | "live" | "offline";

interface SimState {
  status: SimStatus;
  people: SimPerson[];
  threads: Record<string, SimItem[]>;
  typing: string[];
  /** 打开页面之后才到的消息 id（快照里的旧消息不算）：只有它们会触发灯闪和 confetti。 */
  fresh: Set<string>;
}

type Action = { type: "status"; status: SimStatus } | SimServerEvent;

const initial: SimState = { status: "connecting", people: [], threads: {}, typing: [], fresh: new Set() };

function reducer(state: SimState, action: Action): SimState {
  switch (action.type) {
    case "status":
      return { ...state, status: action.status };
    case "snapshot":
      return { ...state, people: action.people, threads: action.threads, typing: action.typing };
    case "item":
      return {
        ...state,
        threads: { ...state.threads, [action.person]: [...(state.threads[action.person] ?? []), action.item] },
        fresh: new Set(state.fresh).add(action.item.id),
      };
    case "reaction": {
      const thread = (state.threads[action.person] ?? []).map((item) =>
        item.id === action.targetId ? { ...item, reactions: [...item.reactions.filter((r) => r.by !== action.reaction.by), action.reaction] } : item,
      );
      return { ...state, threads: { ...state.threads, [action.person]: thread } };
    }
    case "typing":
      return {
        ...state,
        typing: action.on ? [...new Set([...state.typing, action.person])] : state.typing.filter((person) => person !== action.person),
      };
  }
}

/** 连到服务端的 /sim/ws；断线后自动重连（最长隔 4 秒）。 */
export function useSim() {
  const [state, dispatch] = useReducer(reducer, initial);
  const socket = useRef<WebSocket | null>(null);

  useEffect(() => {
    let stopped = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const key = new URLSearchParams(window.location.search).get("key");
    const url = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/sim/ws${key ? `?key=${encodeURIComponent(key)}` : ""}`;

    const connect = () => {
      const ws = new WebSocket(url);
      socket.current = ws;
      ws.onopen = () => {
        attempt = 0;
        dispatch({ type: "status", status: "live" });
      };
      ws.onmessage = (event) => dispatch(JSON.parse(String(event.data)) as SimServerEvent);
      ws.onclose = () => {
        if (stopped) return;
        dispatch({ type: "status", status: "offline" });
        timer = setTimeout(connect, Math.min(4000, 400 * 2 ** attempt++));
      };
    };
    connect();

    return () => {
      stopped = true;
      clearTimeout(timer);
      socket.current?.close();
    };
  }, []);

  const emit = useCallback((event: SimClientEvent) => {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(event));
  }, []);

  const send = useCallback((person: string, text: string) => emit({ type: "send", person, text }), [emit]);
  const react = useCallback((person: string, targetId: string, emoji: string) => emit({ type: "react", person, targetId, emoji }), [emit]);

  return { ...state, send, react };
}
