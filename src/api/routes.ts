// 网页和 JSON API（§5.6）。网页只读；token 只通过本人的私聊发出，不做登录。

import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { existsSync, readFileSync } from "node:fs";
import { attendeeView, organizerView } from "../core/privacy";
import type { Store } from "../db";

const DIST = "web/dist";

const DEV_PAGE = `<!doctype html><meta charset="utf-8"><title>Juno</title>
<p style="font-family:system-ui;margin:2rem">网页还没 build。开发时运行 <code>bun run web:dev</code>，用 http://localhost:5173 加上同样的路径打开；或者先运行 <code>bun run web:build</code>。</p>`;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** 链接预览靠 OG 标签。链接可能被转发，所以这里只放活动标题，不放任何个人信息。 */
function renderPage(title: string | undefined): string {
  const indexPath = `${DIST}/index.html`;
  if (!existsSync(indexPath)) return DEV_PAGE;
  const pageTitle = escapeHtml(title ? `${title} — your plan` : "Juno");
  const og = [`<meta property="og:title" content="${pageTitle}" />`, `<meta property="og:site_name" content="Juno" />`].join("\n    ");
  // TODO(A, M3)：og:image 用目的地的静态地图（Maps Static API）
  return readFileSync(indexPath, "utf8").replace("<!--og-->", og).replace("<title>Juno</title>", `<title>${pageTitle}</title>`);
}

export function createApi(store: Store): Hono {
  const app = new Hono();

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.get("/api/o/:token", (c) => {
    const member = store.memberByToken(c.req.param("token"));
    const event = member?.role === "organizer" ? store.getEvent(member.eventId) : undefined;
    return event ? c.json(organizerView(store, event)) : c.json({ error: "not_found" }, 404);
  });

  app.get("/api/i/:token", (c) => {
    const member = store.memberByToken(c.req.param("token"));
    const event = member?.role === "attendee" ? store.getEvent(member.eventId) : undefined;
    return event && member ? c.json(attendeeView(store, event, member)) : c.json({ error: "not_found" }, 404);
  });

  const page = (token: string) => {
    const member = store.memberByToken(token);
    return renderPage(member ? store.getEvent(member.eventId)?.title : undefined);
  };
  app.get("/o/:token", (c) => c.html(page(c.req.param("token"))));
  app.get("/i/:token", (c) => c.html(page(c.req.param("token"))));
  // 网页模拟器（开发和 demo 备份用）；实时消息走 /sim/ws，在 src/index.ts 里处理
  app.get("/sim", (c) => c.html(renderPage("Juno simulator")));
  app.use("/assets/*", serveStatic({ root: DIST }));

  return app;
}
