// The works grouped by origin (the organization they are for): one group per named origin in
// `origins` ({ origin, income }), in file order and possibly without works, then the works without
// an origin in a last group whose origin is "".
export function groupWorksByOrigin(works, origins) {
  const groups = new Map((origins || []).map((o) => [o.origin, { origin: o.origin, income: o.income, works: [] }]));
  for (const w of works || []) {
    const origin = w.origin || "";
    if (!groups.has(origin)) groups.set(origin, { origin, income: null, works: [] });
    groups.get(origin).works.push(w);
  }
  const list = [...groups.values()];
  return [...list.filter((g) => g.origin), ...list.filter((g) => !g.origin)];
}
