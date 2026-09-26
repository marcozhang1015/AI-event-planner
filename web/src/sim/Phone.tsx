// 一部模拟的 iPhone：一个人和 Juno 的私聊。手机里面尽量还原 iMessage 浅色界面。

import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import type { SimItem, SimPerson } from "@shared/sim";

const TAPBACKS = ["👍", "❤️", "😂", "‼️", "❓"];
const CONFETTI_COLORS = ["#ff5a5f", "#ffb23f", "#3ddc84", "#0a84ff", "#bf5af2", "#ffd60a"];
const SUGGESTION = "plan a hike + dinner saturday near campus, max $40 each";

interface PhoneProps {
  person: SimPerson;
  index: number;
  items: SimItem[];
  typing: boolean;
  fresh: Set<string>;
  onSend: (text: string) => void;
  onReact: (targetId: string, emoji: string) => void;
  /** 录屏脚本：输入框由外部逐字驱动，不能手打，也不能点 tapback。 */
  scripted?: boolean;
  scriptDraft?: string;
  composing?: boolean;
  showHandle?: boolean;
}

function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 46 }, (_, index) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.35,
        duration: 1.5 + Math.random() * 1.2,
        drift: (Math.random() - 0.5) * 80,
        spin: 180 + Math.random() * 540,
        color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
        round: index % 4 === 0,
      })),
    [],
  );
  return (
    <div className="confetti" aria-hidden>
      {pieces.map((piece, index) => (
        <i
          key={index}
          className={piece.round ? "round" : undefined}
          style={
            {
              "--left": `${piece.left}%`,
              "--delay": `${piece.delay}s`,
              "--duration": `${piece.duration}s`,
              "--drift": `${piece.drift}px`,
              "--spin": `${piece.spin}deg`,
              "--color": piece.color,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

/** 链接预览卡。看板和个人页的链接会去读活动标题，和 iMessage 的原生链接预览一样显示。 */
function LinkCard({ url }: { url: string }) {
  const parsed = useMemo(() => {
    try {
      return new URL(url);
    } catch {
      return undefined;
    }
  }, [url]);
  const route = parsed?.pathname.match(/^\/(o|i)\/([\w-]+)/);
  const [title, setTitle] = useState<string>();

  useEffect(() => {
    if (!route) return;
    let alive = true;
    // 只取路径、同源请求：链接里的域名可能是公网地址，模拟器跑在本机也能读到
    fetch(`/api/${route[1]}/${route[2]}`)
      .then((response) => (response.ok ? response.json() : undefined))
      .then((view: { event?: { title?: string } } | undefined) => alive && setTitle(view?.event?.title))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [route?.[1], route?.[2]]);

  const kind = route?.[1] === "o" ? "Organizer dashboard" : route?.[1] === "i" ? "Your plan" : "Link";
  return (
    <a className="link-card" href={url} target="_blank" rel="noreferrer">
      <span className="link-hero">
        <span className="link-mark">J</span>
        <span className="link-kind">{kind}</span>
      </span>
      <span className="link-meta">
        <strong>{title ? `${title} — ${kind.toLowerCase()}` : "Juno"}</strong>
        <span>{parsed?.host ?? url}</span>
      </span>
    </a>
  );
}

function Reactions({ item }: { item: SimItem }) {
  if (!item.reactions.length) return null;
  return (
    <span className={`reactions ${item.from === "user" ? "on-mine" : "on-theirs"}`}>
      {item.reactions.map((reaction) => (
        <span key={reaction.by} className={`reaction by-${reaction.by}`} title={reaction.by === "agent" ? "Juno reacted" : "You reacted"}>
          {reaction.emoji}
        </span>
      ))}
    </span>
  );
}

export function Phone({ person, index, items, typing, fresh, onSend, onReact, scripted = false, scriptDraft = "", composing = false, showHandle = true }: PhoneProps) {
  const [ownDraft, setOwnDraft] = useState("");
  const draft = scripted ? scriptDraft : ownDraft;
  const setDraft = setOwnDraft;
  const [pickerFor, setPickerFor] = useState<string>();
  const [burst, setBurst] = useState(0);
  const [flash, setFlash] = useState(false);
  const thread = useRef<HTMLDivElement>(null);
  const last = items.at(-1);

  // 新消息：滚到底（快照里的旧消息直接跳到底）；Juno 的新消息让头顶的灯闪一下；带特效的放 confetti
  useEffect(() => {
    const isFresh = last !== undefined && fresh.has(last.id);
    thread.current?.scrollTo({ top: thread.current.scrollHeight, behavior: isFresh || typing ? "smooth" : "auto" });
    if (!last || last.from !== "agent" || !isFresh) return;
    setFlash(true);
    if (last.effect === "confetti") setBurst(Date.now());
    const timer = setTimeout(() => setFlash(false), 900);
    return () => clearTimeout(timer);
  }, [last?.id, typing]);

  // 剧本逐字输入时输入框会变高，把已经滚到底的对话留在可见区域
  useEffect(() => {
    if (!scripted) return;
    thread.current?.scrollTo({ top: thread.current.scrollHeight });
  }, [scriptDraft, scripted]);

  useEffect(() => {
    if (!burst) return;
    const timer = setTimeout(() => setBurst(0), 3200);
    return () => clearTimeout(timer);
  }, [burst]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (scripted) return;
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft("");
  };

  const lamp = typing ? "typing" : flash ? "flash" : "idle";

  return (
    <section className="phone" style={{ "--i": index } as CSSProperties} aria-label={`${person.name}'s phone`}>
      <div className="phone-label">
        <span className={`lamp ${lamp}`} aria-hidden />
        <span className="phone-name">{person.name}</span>
        {showHandle && <span className="phone-handle">sim:{person.id}</span>}
      </div>

      <div className="device">
        <div className="screen">
          <div className="status-bar" aria-hidden>
            <span className="clock">9:41</span>
            <span className="island" />
            <span className="icons">
              <span className="signal" />
              <span className="battery" />
            </span>
          </div>

          <header className="chat-header">
            <span className="back" aria-hidden>
              ‹
            </span>
            <span className="avatar" aria-hidden>
              J
            </span>
            <span className="chat-name">
              Juno <span aria-hidden>›</span>
            </span>
          </header>

          <div className="thread" ref={thread} onClick={(event) => event.target === event.currentTarget && setPickerFor(undefined)}>
            <p className="thread-stamp">
              iMessage
              <br />
              Today 9:41 AM
            </p>

            {items.length === 0 && !scripted && (
              <div className="thread-empty">
                <p>No messages yet. Say hi to Juno — or wait for an invite.</p>
                <button type="button" className="suggestion" onClick={() => setDraft(SUGGESTION)}>
                  “{SUGGESTION}”
                </button>
              </div>
            )}

            {items.map((item, position) => {
              const next = items[position + 1];
              const tail = next?.from !== item.from || (typing && item.from === "agent" && !next);
              const mine = item.from === "user";
              return (
                <div key={item.id} className={`row ${mine ? "mine" : "theirs"} ${tail ? "tail" : ""} ${fresh.has(item.id) ? "fresh" : ""}`}>
                  <div className="bubble-wrap">
                    {pickerFor === item.id && (
                      <span className="picker" role="menu" aria-label="Tapback">
                        {TAPBACKS.map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              onReact(item.id, emoji);
                              setPickerFor(undefined);
                            }}
                          >
                            {emoji}
                          </button>
                        ))}
                      </span>
                    )}
                    {item.kind === "link" && item.url ? (
                      <LinkCard url={item.url} />
                    ) : mine ? (
                      <div className="bubble mine">{item.text}</div>
                    ) : scripted ? (
                      <div className={`bubble theirs ${item.effect ? "effect" : ""}`}>{item.text}</div>
                    ) : (
                      <button
                        type="button"
                        className={`bubble theirs ${item.effect ? "effect" : ""}`}
                        aria-label={`Juno: ${item.text}. Tap to react.`}
                        onClick={() => setPickerFor(pickerFor === item.id ? undefined : item.id)}
                      >
                        {item.text}
                      </button>
                    )}
                    <Reactions item={item} />
                  </div>
                  {mine && !next && <span className="receipt">Delivered</span>}
                </div>
              );
            })}

            {typing && (
              <div className="row theirs tail">
                <div className="bubble theirs typing" aria-label="Juno is typing">
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            )}
          </div>

          <form className="composer" onSubmit={submit}>
            <span className="plus" aria-hidden>
              +
            </span>
            <label className="field">
              <span className="sr-only">Message Juno as {person.name}</span>
              {scripted ? (
                <div className={`mirror ${composing ? "on" : ""}`}>
                  {draft ? <span className="typed">{draft}</span> : <span className="placeholder">iMessage</span>}
                  {composing && <i className="caret" />}
                </div>
              ) : (
                <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="iMessage" autoComplete="off" />
              )}
            </label>
            <button type="submit" className="send" disabled={!draft.trim()} aria-label="Send">
              ↑
            </button>
          </form>
        </div>
        {burst > 0 && <Confetti key={burst} />}
      </div>
    </section>
  );
}
