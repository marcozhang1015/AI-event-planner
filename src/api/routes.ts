// 网页和 JSON API（§5.6）。网页只读；token 只通过本人的私聊和邮件发出，不做登录。

import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { existsSync, readFileSync } from "node:fs";
import { escapeHtml } from "../out/html";
import { memberCalendar } from "../out/ics";
import { attendeeView, itineraryView, organizerView, type ViewOptions } from "../out/privacy";
import { weekdayName } from "../shared/time";
import type { Event, Member } from "../shared/types";
import { ChangeSet, publishedOption, type Reader } from "../store/changes";
import type { Store } from "../store/db";
import { mapContent, MapImages } from "./map";

const DEV_PAGE = `<!doctype html><meta charset="utf-8"><title>Juno</title>
<p style="font-family:system-ui;margin:2rem">网页还没 build。开发时运行 <code>bun run web:dev</code>，用 http://localhost:5173 加上同样的路径打开；或者先运行 <code>bun run web:build</code>。</p>`;

export interface ApiOptions {
  baseUrl: string;
  agentName: string;
  emailFrom: string;
  /** 有 key 才代理静态地图（/map/:token.png），也才在链接预览里放地图。 */
  mapsServerKey?: string;
  /** vite build 的输出目录（默认 web/dist）。 */
  distDir?: string;
}

interface OgTags {
  title: string;
  description?: string;
  image?: string;
}

/** 链接预览靠 OG 标签。链接可能被转发，所以只放活动标题、日期和场地地图，不放任何个人信息。 */
function renderPage(dist: string, og: OgTags | undefined): string {
  const indexPath = `${dist}/index.html`;
  if (!existsSync(indexPath)) return DEV_PAGE;
  const title = escapeHtml(og?.title ?? "Juno");
  const tags = [
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:site_name" content="Juno" />`,
    og?.description ? `<meta property="og:description" content="${escapeHtml(og.description)}" />` : undefined,
    og?.image ? `<meta property="og:image" content="${escapeHtml(og.image)}" />` : undefined,
  ].filter(Boolean);
  return readFileSync(indexPath, "utf8").replace("<!--og-->", tags.join("\n    ")).replace("<title>Juno</title>", `<title>${title}</title>`);
}

function ogFor(event: Event, token: string, opts: ApiOptions): OgTags {
  return {
    title: `${event.title} — your plan`,
    description: [event.day ? weekdayName(event.day) : undefined, event.area?.label].filter(Boolean).join(" · ") || undefined,
    image: opts.mapsServerKey ? `${opts.baseUrl}/map/${token}.png?scope=public` : undefined,
  };
}

/** 本人行程的日历文件（PUBLISH），和邮件里的邀请同一个 UID。方案还没发布、或者本人不在方案里时没有。 */
function calendarFile(db: Reader, event: Event, member: Member, opts: ApiOptions, views: ViewOptions): string | undefined {
  const live = publishedOption(db, event.published);
  const itinerary = live && event.day ? itineraryView(db, event, live, member, views) : undefined;
  if (!itinerary || !event.day) return undefined;
  return memberCalendar(opts, { event, member, itinerary, method: "PUBLISH", day: event.day });
}

export function createApi(store: Store, opts: ApiOptions): Hono {
  const app = new Hono();
  const dist = opts.distDir ?? "web/dist";
  const views: ViewOptions = { baseUrl: opts.baseUrl, mapImages: Boolean(opts.mapsServerKey) };
  const maps = opts.mapsServerKey ? new MapImages(opts.mapsServerKey) : undefined;

  /** 每个请求一份只读快照。 */
  const open = (token: string, role?: Member["role"]) => {
    const db = new ChangeSet(store);
    const member = store.memberByToken(token);
    const event = member && (!role || member.role === role) ? db.event(member.eventId) : undefined;
    return event && member ? { db, event, member } : undefined;
  };

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.get("/api/o/:token", (c) => {
    const found = open(c.req.param("token"), "organizer");
    return found ? c.json(organizerView(found.db, found.event, views)) : c.json({ error: "not_found" }, 404);
  });

  app.get("/api/i/:token", (c) => {
    const found = open(c.req.param("token"), "attendee");
    return found ? c.json(attendeeView(found.db, found.event, found.member, views)) : c.json({ error: "not_found" }, 404);
  });

  for (const prefix of ["o", "i"] as const) {
    const role = prefix === "o" ? "organizer" : "attendee";
    app.get(`/${prefix}/:token/calendar.ics`, (c) => {
      const found = open(c.req.param("token"), role);
      const ics = found && calendarFile(found.db, found.event, found.member, opts, views);
      if (!ics) return c.text("No plan yet.", 404);
      return c.body(ics, 200, { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'attachment; filename="juno.ics"' });
    });
    app.get(`/${prefix}/:token`, (c) => {
      const token = c.req.param("token");
      const found = open(token, role);
      return c.html(renderPage(dist, found ? ogFor(found.event, token, opts) : undefined));
    });
  }

  app.get("/map/:file", async (c) => {
    const found = maps ? open(c.req.param("file").replace(/\.png$/, "")) : undefined;
    const image = found && (await maps!.fetch(mapContent(found.db, found.event, found.member, c.req.query("scope") === "public", views)));
    if (!image) return c.notFound();
    return c.body(image, 200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=300" });
  });

  // 网页模拟器（开发和 demo 备份用）；实时消息走 /sim/ws，在 src/index.ts 里处理
  app.get("/sim", (c) => c.html(renderPage(dist, { title: "Juno simulator" })));
  // 录屏页：纯前端剧本，不走 WebSocket
  app.get("/demo", (c) => c.html(renderPage(dist, { title: "Juno" })));
  app.use("/assets/*", serveStatic({ root: dist }));

  return app;
}
