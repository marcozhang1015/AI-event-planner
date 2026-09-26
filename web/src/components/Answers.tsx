// 行程页上"你告诉我的"：本人答过的字段。还没问到的（undefined）不显示。

import type { PublicAnswer } from "@shared/views";
import { fmtMoney, fmtTime, fmtWindow } from "@shared/time";
import type { Drives } from "@shared/types";
import { count } from "../format";

export function Answers({ answer }: { answer: PublicAnswer }) {
  const rows = answerRows(answer);
  if (!rows.length) return null;
  return (
    <section aria-labelledby="answers-heading">
      <h3 id="answers-heading" className="label section-label">
        What you told me
      </h3>
      <dl className="facts">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function answerRows(answer: PublicAnswer): [string, string][] {
  const rows: [string, string | undefined][] = [
    ["Free", answer.free?.map(fmtWindow).join(", ")],
    ["Home by", answer.homeBy && fmtTime(answer.homeBy)],
    ["Allergies", answer.allergies && (answer.allergies.length ? answer.allergies.join(", ") : "None")],
    ["Diet", answer.diet?.length ? answer.diet.join(", ") : undefined],
    ["Rides", answer.drives && ridesText(answer.drives, answer.seats)],
    ["Pickup", answer.pickup],
    ["Budget", answer.budgetCapCents === undefined ? undefined : `Up to ${fmtMoney(answer.budgetCapCents)}`],
  ];
  return rows.filter((row): row is [string, string] => Boolean(row[1]));
}

function ridesText(drives: Drives, seats: number | undefined): string {
  if (drives === "no") return "Needs a ride";
  const withSeats = seats === undefined ? "" : `, ${count(seats, "spare seat", "spare seats")}`;
  return (drives === "yes" ? "Driving" : "Can drive if needed") + withSeats;
}
