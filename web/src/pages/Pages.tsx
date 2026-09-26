// 看板和个人行程页的入口（和模拟器分开打包，只在这些页面加载下面的字体和样式）。
// 按路径取数据：/o/:token 组织者看板，/i/:token 个人行程页；其他路径提示去 iMessage 里点链接。

import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "@fontsource/martian-mono/400.css";
import "@fontsource/martian-mono/600.css";
import "./pages.css";

import type { AttendeeView, OrganizerView } from "@shared/views";
import { usePolling } from "./usePolling";
import { ItineraryPage } from "./Itinerary";
import { Notice } from "./Notice";
import { OrganizerPage } from "./Organizer";

export function Pages({ path }: { path: string }) {
  const match = path.match(/^\/(o|i)\/([\w-]+)/);
  const poll = usePolling<OrganizerView | AttendeeView>(match ? `/api/${match[1]}/${match[2]}` : undefined);

  if (!match) return <Notice>Open the link Juno sent you in iMessage.</Notice>;
  if (poll.status === "loading") return <Notice busy>Loading…</Notice>;
  if (poll.status === "missing") return <Notice>This link doesn't exist.</Notice>;
  if (poll.status === "failed") return <Notice busy>Can't reach Juno right now — trying again…</Notice>;
  return poll.data.role === "organizer" ? <OrganizerPage view={poll.data} live={!poll.stale} /> : <ItineraryPage view={poll.data} live={!poll.stale} />;
}
