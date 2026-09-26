// 求解器的不变量（§5.10）。C 实现 solve() 时把 todo 逐个改成真测试。

import { describe, test } from "bun:test";

const todo = (name: string) => test.todo(name, () => {});

describe("求解器不变量", () => {
  todo("不超座：每辆车的乘客数不超过司机的空座");
  todo("每个需要接送的人，去程和回程都恰好坐一辆车");
  todo("每人费用上界不超过本人预算");
  todo("对某人过敏标为 UNSUPPORTED 的餐厅，不会出现在他参加的方案里");
  todo("UNKNOWN 的过敏事实不算通过：方案状态是 NEEDS_VERIFICATION，并列出这一项");
  todo("车程缺失的组合不会被当成 0 分钟");
  todo("送回时间不晚于每个人的最晚到家时间");
  todo("优先不用 if_needed 司机；用到时列进 ifNeededDrivers");
  todo("同样的输入得到同样的输出");
  todo("demo 场景：Plan A 是 Pine Ridge + Maple Kitchen，5/5 人；Plan B 是 Olive Tree，Leo 因预算被排除");
});
