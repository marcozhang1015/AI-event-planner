import { describe, expect, test } from "bun:test";
import { Harness, textsTo } from "./harness";

const PETER = "+13148149677";
const contacts = [{ name: "Peter", handle: PETER }];

describe("Peter 固定剧本", () => {
  test("只按轮次推进，并把假总结和方案排进定时队列", async () => {
    const h = new Harness({ contacts, scriptedPeter: true });

    expect(textsTo(await h.send(PETER, "hey"), PETER)[0]).toContain("AI coordinator");
    expect(textsTo(await h.send(PETER, "go hiking and have dinner"), PETER)).toEqual(["That sounds fun — who are you thinking of going with?"]);

    const contactsReply = textsTo(await h.send(PETER, "Marco, Phil, Josh and Alvin"), PETER)[0]!;
    expect(contactsReply).toContain("Marco — +1 (314) 555-0182");
    expect(contactsReply).toContain("anything you’d like me to keep in mind");

    const queued = await h.send(PETER, "No, just ask them");
    expect(queued[0]).toMatchObject({ kind: "react", emoji: "👍", fallback: "Got it — I’ll check with everyone." });
    expect(queued[1]).toMatchObject({ kind: "schedule", to: PETER, action: { kind: "send" } });
    expect(queued[2]).toMatchObject({ kind: "schedule", to: PETER, action: { kind: "send" } });
    if (queued[1]?.kind === "schedule") expect(queued[1].action.parts[0]).toContain("I heard back from everyone");
    if (queued[2]?.kind === "schedule") expect(queued[2].action.parts[0]).toContain("Riverside Trail");

    expect(textsTo(await h.send(PETER, "confirm"), PETER)).toEqual(["We’re all set! Have a great time 😊"]);
  });

  test("不开固定模式时仍走原来的离线流程", async () => {
    const h = new Harness({ contacts });
    expect(textsTo(await h.send(PETER, "hey"), PETER)[0]).toContain("Tell me what you have in mind");
  });
});
