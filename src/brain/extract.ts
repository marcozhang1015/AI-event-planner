// Claude 负责理解和措辞（§5.4）：一次调用返回 { intent, patch, askingAbout, reply }。
// 出任何错都返回 undefined，flow 会退回规则解析和模板问题。

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { config } from "../config";
import type { AnswerPatch, EventPatch, Extraction } from "../types";
import { parseEmail } from "./parse";
import { ATTENDEE_SYSTEM, ORGANIZER_SYSTEM } from "./prompts";

export interface BrainContext {
  /** "2026-09-26 (Saturday)" */
  today: string;
  /** 活动的公开信息，一行。 */
  eventLine: string;
  /** 这个人自己已经给过的字段。 */
  known: Record<string, unknown>;
  /** 按提问顺序排列的缺失字段。 */
  missing: string[];
  history: { from: "juno" | "them"; text: string }[];
  incoming: string[];
}

export interface Brain {
  organizer(context: BrainContext): Promise<Extraction<EventPatch> | undefined>;
  attendee(context: BrainContext): Promise<Extraction<AnswerPatch> | undefined>;
}

/** 不调模型：所有轮次都走规则解析和模板问题。 */
export const offlineBrain: Brain = {
  organizer: async () => undefined,
  attendee: async () => undefined,
};

const intent = z.enum(["answer", "confirm", "change", "question", "smalltalk", "other"]);
const time = z.string().nullable().describe('"HH:MM", 24-hour, event local time');

const organizerOutput = z.object({
  intent,
  patch: z.object({
    title: z.string().nullable(),
    day: z.string().nullable().describe('"YYYY-MM-DD"'),
    windowStart: time,
    windowEnd: time,
    areaLabel: z.string().nullable(),
    budgetCapCents: z.number().int().nullable(),
    headcount: z.number().int().nullable(),
  }),
  askingAbout: z.string().nullable(),
  reply: z.string(),
});

const attendeeOutput = z.object({
  intent,
  patch: z.object({
    freeFrom: time,
    freeUntil: time,
    homeBy: time,
    budgetCapCents: z.number().int().nullable(),
    allergies: z.array(z.string()).nullable(),
    diet: z.array(z.string()).nullable(),
    drives: z.enum(["yes", "if_needed", "no"]).nullable(),
    seats: z.number().int().nullable(),
    pickupQuery: z.string().nullable(),
    email: z.string().nullable(),
  }),
  askingAbout: z.string().nullable(),
  reply: z.string(),
});

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

const timeOrUndefined = (value: string | null) => (value && HHMM.test(value) ? value : undefined);
const centsOrUndefined = (value: number | null) => (value !== null && value >= 0 ? value : undefined);
const textOrUndefined = (value: string | null) => value?.trim() || undefined;

/** 去掉值为 undefined 的键，让"没说"和"说了"容易区分。 */
function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

function toEventPatch(patch: z.infer<typeof organizerOutput>["patch"]): EventPatch {
  const start = timeOrUndefined(patch.windowStart);
  const end = timeOrUndefined(patch.windowEnd);
  return compact({
    title: textOrUndefined(patch.title),
    day: patch.day && YMD.test(patch.day) ? patch.day : undefined,
    window: start || end ? compact({ start, end }) : undefined,
    areaLabel: textOrUndefined(patch.areaLabel),
    budgetCapCents: centsOrUndefined(patch.budgetCapCents),
    headcount: patch.headcount !== null && patch.headcount > 0 ? patch.headcount : undefined,
  });
}

function toAnswerPatch(patch: z.infer<typeof attendeeOutput>["patch"]): AnswerPatch {
  const start = timeOrUndefined(patch.freeFrom);
  const end = timeOrUndefined(patch.freeUntil);
  return compact({
    free: start || end ? compact({ start, end }) : undefined,
    homeBy: timeOrUndefined(patch.homeBy),
    budgetCapCents: centsOrUndefined(patch.budgetCapCents),
    allergies: patch.allergies ?? undefined,
    diet: patch.diet ?? undefined,
    drives: patch.drives ?? undefined,
    seats: patch.seats !== null && patch.seats >= 0 && patch.seats <= 8 ? patch.seats : undefined,
    pickupQuery: textOrUndefined(patch.pickupQuery),
    email: patch.email ? parseEmail(patch.email) : undefined,
  });
}

function renderContext(context: BrainContext): string {
  const history = context.history.map((line) => `${line.from === "juno" ? "Juno" : "Them"}: ${line.text}`).join("\n");
  return [
    `Today: ${context.today}`,
    `Event: ${context.eventLine}`,
    `Known so far: ${JSON.stringify(context.known)}`,
    `Still missing, in order: ${context.missing.join(", ") || "(nothing)"}`,
    `Recent conversation:\n${history || "(none)"}`,
    `New messages from them:\n${context.incoming.join("\n")}`,
  ].join("\n\n");
}

export function claudeBrain(client = new Anthropic()): Brain {
  async function run<S extends z.ZodType>(system: string, schema: S, context: BrainContext): Promise<z.infer<S> | undefined> {
    const content = renderContext(context);
    let response;
    try {
      response = await client.beta.messages.parse(
        {
          model: config.model,
          max_tokens: 16000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
          output_config: { effort: "low", format: betaZodOutputFormat(schema) },
          messages: [{ role: "user", content }],
        },
        { timeout: config.llmTimeoutMs, maxRetries: 0 },
      );
    } catch (error) {
      // 超时、限流、没配凭证（SDK 抛的是普通 Error）……调用失败一律退回模板（§5.12）
      console.warn(`[brain] Claude 调用失败，改用模板：${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
    if (response.stop_reason !== "end_turn") {
      // refusal（fallback 模型也拒绝了）、max_tokens 等：输出不一定符合 schema
      console.warn(`[brain] stop_reason=${response.stop_reason}，改用模板`);
      return undefined;
    }
    return response.parsed_output ?? undefined;
  }

  return {
    async organizer(context) {
      const output = await run(ORGANIZER_SYSTEM, organizerOutput, context);
      if (!output) return undefined;
      return { intent: output.intent, patch: toEventPatch(output.patch), askingAbout: output.askingAbout ?? undefined, reply: output.reply };
    },
    async attendee(context) {
      const output = await run(ATTENDEE_SYSTEM, attendeeOutput, context);
      if (!output) return undefined;
      return { intent: output.intent, patch: toAnswerPatch(output.patch), askingAbout: output.askingAbout ?? undefined, reply: output.reply };
    },
  };
}

export function createBrain(): Brain {
  return config.llm ? claudeBrain() : offlineBrain;
}
