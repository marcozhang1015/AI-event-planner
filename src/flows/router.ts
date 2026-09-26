import { isForgetMe } from "../core/memory";
import { say, type Outbound } from "../out/actions";
import { templates as t } from "../out/imessage";
import { attendeeTurn } from "./attendee";
import { textOf, type FlowDeps, type Turn } from "./context";
import { organizerTurn } from "./organizer";

/** 一轮对话的入口：按这个人的会话决定走组织者还是参与者流程。陌生人按"想发起活动"处理。 */
export async function handleTurn(deps: FlowDeps, turn: Turn): Promise<Outbound[]> {
  // 任何时候说 "forget me" 都删掉跨活动记忆；这次活动里已经说过的不受影响
  if (isForgetMe(textOf(turn))) {
    deps.db.forgetPerson(turn.handle);
    return [say(turn.handle, t.forgotten())];
  }

  const session = deps.db.session(turn.handle);
  if (session.eventId && session.role === "attendee") return attendeeTurn(deps, turn, session);
  return organizerTurn(deps, turn, session);
}
