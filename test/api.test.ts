// 网页 API：隐私投影、日历下载、链接预览、地图代理。用 published 阶段的种子数据。

import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AttendeeView, OrganizerView } from "../src/shared/views";
import { mapContent } from "../src/api/map";
import { createApi } from "../src/api/routes";
import { ChangeSet } from "../src/store/changes";
import { Store } from "../src/store/db";
import { seedDemo } from "../src/demo/seed";
import { calendarUid } from "../src/out/ics";

const store = new Store(":memory:");
// 页面模板用临时目录，测试不依赖 vite build
const distDir = mkdtempSync(join(tmpdir(), "juno-dist-"));
writeFileSync(join(distDir, "index.html"), "<html><head><!--og--><title>Juno</title></head><body></body></html>");
const options = { baseUrl: "https://juno.test", agentName: "Juno", emailFrom: "Juno <juno@example.com>", distDir };
const api = createApi(store, options);

beforeAll(async () => {
  await seedDemo(store, { stage: "published", contacts: [], now: new Date("2026-09-24T15:00:00Z"), timezone: "America/Chicago", baseUrl: options.baseUrl, emailFrom: options.emailFrom });
});

async function json<T>(path: string): Promise<T> {
  const response = await api.request(path);
  expect(response.status).toBe(200);
  return (await response.json()) as T;
}

describe("网页 API", () => {
  test("组织者看板：已发布的方案、进度、自己的行程；没有个人预算数字，成员信息里没有过敏", async () => {
    const view = await json<OrganizerView>("/api/o/demo-alex");
    expect(view.plan).toMatchObject({ state: "live", publishedLabel: "A" });
    expect(view.plan!.options[0]).toMatchObject({ label: "A", status: "FEASIBLE" });
    expect(view.counts).toEqual({ total: 5, confirmed: 5, waiting: 0 });
    expect(view.me?.role).toBe("driver");
    const text = JSON.stringify(view);
    expect(text).not.toContain('"budgetCapCents":3000'); // Leo 的预算
    expect(JSON.stringify(view.members)).not.toContain("peanut");
    expect(text).not.toContain("sim:"); // 不暴露 handle
  });

  test("个人行程页：本人的行程和同车人，看不到别人的答案", async () => {
    const view = await json<AttendeeView>("/api/i/demo-sam");
    expect(view.itinerary).toMatchObject({ role: "rider", version: 1 });
    expect(view.itinerary!.dinner.note).toContain("peanut");
    expect(view.me.answer.allergies).toEqual(["peanuts (severe)"]);
    expect(JSON.stringify(view)).not.toContain('"budgetCapCents":3000'); // Leo 的预算
  });

  test("token 对不上角色就是 404", async () => {
    expect((await api.request("/api/o/demo-sam")).status).toBe(404);
    expect((await api.request("/api/i/nope")).status).toBe(404);
  });

  test("加入日历：PUBLISH 版本，和邮件邀请同一个 UID", async () => {
    const response = await api.request("/i/demo-sam/calendar.ics");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/calendar");
    const ics = await response.text();
    expect(ics).toContain("METHOD:PUBLISH");
    expect(ics).toContain(`UID:${calendarUid("evt_demo", "sim:sam")}`);
    expect(ics).toContain("SEQUENCE:0");
  });

  test("链接预览只有活动信息；有地图 key 才有 og:image，没 key 时地图代理是 404", async () => {
    const page = await (await api.request("/i/demo-sam")).text();
    expect(page).toContain('<meta property="og:title" content="hike + dinner — your plan" />');
    expect(page).not.toContain("og:image");
    expect(page).not.toContain("Sam");
    expect((await api.request("/map/demo-sam.png")).status).toBe(404);

    const withKey = createApi(store, { ...options, mapsServerKey: "test-key" });
    expect(await (await withKey.request("/i/demo-sam")).text()).toContain('<meta property="og:image" content="https://juno.test/map/demo-sam.png?scope=public" />');
  });
});

describe("静态地图画什么", () => {
  test("链接预览只画活动和餐厅；参与者自己的地图画他的路线", () => {
    const db = new ChangeSet(store);
    const event = db.event("evt_demo")!;
    const sam = db.member(event.id, "sim:sam")!;
    const views = { baseUrl: options.baseUrl, mapImages: true };
    const preview = mapContent(db, event, sam, true, views);
    expect(preview.markers.map((m) => m.kind).sort()).toEqual(["activity", "restaurant"]);
    expect(preview.paths).toEqual([]);
    const own = mapContent(db, event, sam, false, views);
    expect(own.markers.map((m) => m.kind)).toEqual(["pickup", "activity", "restaurant"]);
    expect(own.paths).toHaveLength(1);
  });
});
