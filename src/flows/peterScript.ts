// LLM 关闭时给 Peter 的固定真机演示。只按轮次推进，不解析用户输入，也不联系参与者。

import { later, react, say, type Outbound } from "../out/actions";
import { lastTextId, type FlowDeps, type Turn } from "./context";

const STAGE = {
  plan: "peter_script:plan",
  people: "peter_script:people",
  preferences: "peter_script:preferences",
  confirm: "peter_script:confirm",
  done: "peter_script:done",
} as const;

const INTRO = "Hey! I’m Juno, your AI coordinator. Tell me what you’re planning, and I’ll take it from there.";

const CONTACTS = [
  "Just making sure I found the right people:",
  "",
  "Marco — +1 (314) 555-0182",
  "Phil — +1 (314) 555-0187",
  "Josh — +1 (314) 555-0194",
  "Alvin — +1 (314) 555-0163",
  "",
  "Are these them? And is there anything you’d like me to keep in mind?",
].join("\n");

const UPDATE = [
  "Quick update — I heard back from everyone:",
  "",
  "• Marco is free after 3:30 PM and needs to be home by 10.",
  "• Phil would love something scenic, but nothing too steep.",
  "• Josh is vegetarian and prefers mild food.",
  "• Alvin can drive three people from North Station.",
  "",
  "Everyone is comfortable keeping it under $40 per person.",
].join("\n");

const PLAN = [
  "Here’s what works best for everyone:",
  "",
  "🥾 3:30 PM — Riverside Trail, main loop",
  "🍽️ Dinner — Maple Kitchen",
  "🚗 Alvin can drive from North Station",
  "🏠 Everyone home by 10 PM",
  "💵 Under $40 per person",
  "",
  "Want me to lock this in?",
].join("\n");

function after(now: Date, milliseconds: number): Date {
  return new Date(now.getTime() + milliseconds);
}

export function peterScriptTurn(deps: FlowDeps, turn: Turn): Outbound[] {
  const session = deps.db.session(turn.handle);

  switch (session.asked) {
    case STAGE.plan:
      deps.db.putSession({ handle: turn.handle, asked: STAGE.people });
      return [say(turn.handle, "That sounds fun — who are you thinking of going with?")];

    case STAGE.people:
      deps.db.putSession({ handle: turn.handle, asked: STAGE.preferences });
      return [say(turn.handle, CONTACTS)];

    case STAGE.preferences: {
      deps.db.putSession({ handle: turn.handle, asked: STAGE.confirm });
      const acknowledgement = lastTextId(turn)
        ? react(turn.handle, lastTextId(turn)!, "👍", "Got it — I’ll check with everyone.")
        : say(turn.handle, "Got it — I’ll check with everyone.");
      return [acknowledgement, later(turn.handle, after(deps.now, 4_000), UPDATE), later(turn.handle, after(deps.now, 7_000), PLAN)];
    }

    case STAGE.confirm:
      deps.db.putSession({ handle: turn.handle, asked: STAGE.done });
      return [say(turn.handle, "We’re all set! Have a great time 😊")];

    case STAGE.done:
      return [say(turn.handle, "You’re all set — have a great time 😊")];

    default:
      deps.db.putSession({ handle: turn.handle, asked: STAGE.plan });
      return [say(turn.handle, INTRO)];
  }
}
