import { describe, expect, test } from "bun:test";
import { preflight } from "../src/config";

const base = {
  providers: ["sim"] as ("sim" | "imessage" | "terminal")[],
  simKey: undefined as string | undefined,
  publicBaseUrl: "http://localhost:3000",
  llm: false,
  mapsMode: "sample" as const,
  quietHours: undefined,
};

describe("启动检查", () => {
  test("默认的本机开发配置没有问题", () => {
    expect(preflight(base, [{ name: "Sam", handle: "sim:sam" }], {})).toEqual({ errors: [], warnings: [] });
  });

  test("公网地址 + sim 却没设 SIM_KEY：拒绝启动", () => {
    const result = preflight({ ...base, publicBaseUrl: "https://juno.example.com" }, [], {});
    expect(result.errors[0]).toContain("SIM_KEY");
    expect(preflight({ ...base, publicBaseUrl: "https://juno.example.com", simKey: "k" }, [], {}).errors).toEqual([]);
  });

  test("真机测试前容易漏的配置都会提醒", () => {
    const { errors, warnings } = preflight(
      { ...base, providers: ["imessage"], llm: true, quietHours: { start: "22:00", end: "08:00" } },
      [
        { name: "Alex", handle: "+15550000001" },
        { name: "Sam", handle: "+15550000001" },
        { name: "Mia", handle: "sim:mia" },
        { name: "Bad", handle: "555-0101" },
      ],
      {},
    );
    expect(errors).toEqual([]);
    const all = warnings.join("\n");
    expect(all).toContain("PUBLIC_BASE_URL 还是本机地址");
    expect(all).toContain("ANTHROPIC_API_KEY");
    expect(all).toContain("Alex 和 Sam 是同一个 handle");
    expect(all).toContain("Mia 在模拟器里");
    expect(all).toContain("Bad 的 \"555-0101\" 不像号码或邮箱");
    expect(all).toContain("MAPS_MODE=sample");
    expect(all).toContain("夜间免打扰 10 PM–8 AM");
  });
});
