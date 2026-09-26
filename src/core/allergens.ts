// 过敏的叫法 → 场地事实的键（Venue.facts / Verification.fact）。"peanuts (severe)" 和 "peanut" 要对到同一个键。

const KEYS: [RegExp, string][] = [
  [/peanut|花生/, "peanut"],
  [/tree ?nut|almond|cashew|walnut|pecan|hazelnut|pistachio|macadamia|\bnuts?\b|坚果/, "tree_nut"],
  [/shellfish|shrimp|prawn|crab|lobster|clam|oyster|mussel|scallop|贝|虾|蟹/, "shellfish"],
  [/\bfish\b|salmon|tuna|cod|鱼/, "fish"],
  [/gluten|wheat|celiac|coeliac|麸质|小麦/, "gluten"],
  [/dairy|milk|lactose|cheese|butter|乳|奶/, "dairy"],
  [/\beggs?\b|蛋/, "egg"],
  [/\bsoy|大豆|黄豆/, "soy"],
  [/sesame|芝麻/, "sesame"],
];

const LABELS: Record<string, string> = { tree_nut: "tree nut" };

/** 过敏描述 → 事实键。认不出的用规范化后的原话（小写、去掉括号、非字母数字换成下划线）。 */
export function allergenKey(text: string): string {
  const t = text.toLowerCase();
  for (const [pattern, key] of KEYS) if (pattern.test(t)) return key;
  return (
    t
      .replace(/\(.*?\)/g, " ")
      .replace(/\b(?:severe(?:ly)?|allerg(?:y|ic|ies)|mild)\b/g, " ")
      .trim()
      .replace(/[^a-z0-9一-鿿]+/g, "_")
      .replace(/^_|_$/g, "") || "unknown"
  );
}

/** 事实键 → 给人看的叫法："tree_nut" → "tree nut"。 */
export function allergenLabel(key: string): string {
  return LABELS[key] ?? key.replaceAll("_", " ");
}

/** 描述里说了是严重过敏吗。 */
export function isSevere(text: string): boolean {
  return /severe|anaphyla|epipen|serious|严重/i.test(text);
}
