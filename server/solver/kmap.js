// Deterministic K-map solver. The LLM never does this part.
const NAMES = ["A", "B", "C", "D"];
const gray = (k) => Array.from({ length: 1 << k }, (_, i) => i ^ (i >> 1));
const popcount = (x) => x.toString(2).replace(/0/g, "").length;

export function buildKmap({ vars, minterms, dontCares = [] }) {
  if (![2, 3, 4].includes(vars)) throw new Error("vars must be 2, 3 or 4");
  const size = 1 << vars;
  const all = [...minterms, ...dontCares];
  if (all.some((m) => !Number.isInteger(m) || m < 0 || m >= size))
    throw new Error(`minterms must be integers between 0 and ${size - 1}`);
  if (minterms.some((m) => dontCares.includes(m)))
    throw new Error("a cell cannot be both a minterm and a don't-care");

  const rowBits = vars >> 1;
  const colBits = vars - rowBits;
  const rowGray = gray(rowBits);
  const colGray = gray(colBits);
  const bin = (v, k) => v.toString(2).padStart(k, "0");
  const grid = rowGray.map((rg) =>
    colGray.map((cg) => {
      const m = (rg << colBits) | cg;
      return { m, value: minterms.includes(m) ? 1 : dontCares.includes(m) ? "X" : 0 };
    })
  );
  const pos = {};
  grid.forEach((row, r) => row.forEach((cell, c) => (pos[cell.m] = { r, c })));
  return {
    vars,
    names: NAMES.slice(0, vars),
    minterms: [...minterms].sort((a, b) => a - b),
    dontCares: [...dontCares].sort((a, b) => a - b),
    rowVars: NAMES.slice(0, rowBits).join(""),
    colVars: NAMES.slice(rowBits, vars).join(""),
    rowLabels: rowGray.map((g) => bin(g, rowBits)),
    colLabels: colGray.map((g) => bin(g, colBits)),
    grid,
    pos,
  };
}

export function groupToTerm(p, names) {
  const n = names.length;
  const lits = [];
  names.forEach((name, i) => {
    const bit = 1 << (n - 1 - i);
    if (p.mask & bit) return;
    lits.push(p.value & bit ? name : name + "'");
  });
  return lits.length ? lits.join("") : "1";
}

// Quine-McCluskey: combine implicants differing in one bit until nothing combines.
export function findPrimeImplicants(kmap) {
  const n = kmap.vars;
  const size = 1 << n;
  const key = (t) => `${t.value}:${t.mask}`;
  let cur = [...kmap.minterms, ...kmap.dontCares].map((m) => ({ value: m, mask: 0 }));
  const primes = [];
  while (cur.length) {
    const used = new Set();
    const next = new Map();
    for (let i = 0; i < cur.length; i++) {
      for (let j = i + 1; j < cur.length; j++) {
        const a = cur[i], b = cur[j];
        if (a.mask !== b.mask) continue;
        const diff = a.value ^ b.value;
        if (diff && !(diff & (diff - 1))) {
          const t = { value: a.value & ~diff, mask: a.mask | diff };
          next.set(key(t), t);
          used.add(key(a));
          used.add(key(b));
        }
      }
    }
    cur.forEach((t) => !used.has(key(t)) && primes.push(t));
    cur = [...next.values()];
  }
  const list = primes
    .map((p) => {
      const minterms = [];
      for (let m = 0; m < size; m++) if ((m & ~p.mask) === p.value) minterms.push(m);
      const covers = minterms.filter((m) => kmap.minterms.includes(m));
      return {
        ...p,
        minterms,
        covers,
        size: minterms.length,
        term: groupToTerm(p, kmap.names),
        eliminated: kmap.names.filter((_, i) => p.mask & (1 << (n - 1 - i))),
        cells: minterms.map((m) => ({ m, ...kmap.pos[m] })),
      };
    })
    .filter((p) => p.covers.length > 0) // drop groups made only of don't-cares
    .sort((a, b) => b.size - a.size || a.term.localeCompare(b.term));
  list.forEach((p, i) => (p.id = `G${i + 1}`));
  return list;
}

// Essential PIs first, then the smallest cover of what is left.
export function selectCover(kmap, primes) {
  const ones = kmap.minterms;
  const essential = [];
  const reasons = {};
  for (const m of ones) {
    const ps = primes.filter((p) => p.covers.includes(m));
    if (ps.length === 1 && !essential.includes(ps[0])) {
      essential.push(ps[0]);
      reasons[ps[0].id] = m;
    }
  }
  const covered = new Set(essential.flatMap((p) => p.covers));
  const remaining = ones.filter((m) => !covered.has(m));
  let extra = [];
  let alternatives = 1;
  if (remaining.length) {
    const rest = primes.filter((p) => !essential.includes(p) && p.covers.some((m) => remaining.includes(m)));
    let best = null;
    for (let mask = 1; mask < 1 << rest.length; mask++) {
      const subset = rest.filter((_, i) => mask & (1 << i));
      const got = new Set(subset.flatMap((p) => p.covers));
      if (!remaining.every((m) => got.has(m))) continue;
      const cost = [subset.length, subset.reduce((s, p) => s + (kmap.vars - popcount(p.mask)), 0)];
      if (!best || cost[0] < best.cost[0] || (cost[0] === best.cost[0] && cost[1] < best.cost[1])) {
        best = { subset, cost };
        alternatives = 1;
      } else if (cost[0] === best.cost[0] && cost[1] === best.cost[1]) alternatives++;
    }
    extra = best.subset;
  }
  const chosen = [...essential, ...extra];
  const expression = ones.length === 0 ? "0" : chosen.map((p) => p.term).join(" + ");
  return {
    essential: essential.map((p) => ({ id: p.id, forcedBy: reasons[p.id] })),
    chosen: chosen.map((p) => p.id),
    expression,
    alternatives,
  };
}

export function verifyEquivalence(kmap, primes, chosenIds) {
  const chosen = primes.filter((p) => chosenIds.includes(p.id));
  for (let m = 0; m < 1 << kmap.vars; m++) {
    if (kmap.dontCares.includes(m)) continue;
    const got = chosen.some((p) => (m & ~p.mask) === p.value) ? 1 : 0;
    const want = kmap.minterms.includes(m) ? 1 : 0;
    if (got !== want) return { equivalent: false, counterexample: { minterm: m, expected: want, got } };
  }
  return { equivalent: true, counterexample: null };
}

export function strip(kmap) {
  const { pos, ...rest } = kmap;
  return rest;
}

export function solveDeterministic(input) {
  const kmap = buildKmap(input);
  const primes = findPrimeImplicants(kmap);
  const cover = selectCover(kmap, primes);
  const verification = verifyEquivalence(kmap, primes, cover.chosen);
  return { kmap: strip(kmap), primes, cover, verification };
}

export function templateExplanation(r) {
  const { kmap, primes, cover, verification } = r;
  const L = [];
  L.push(`Step 1 - Place the 1s. ${kmap.vars}-variable map, rows ${kmap.rowVars} and columns ${kmap.colVars} in Gray-code order (${kmap.colLabels.join(", ")}), so neighbouring cells differ in one variable.`);
  L.push(`Minterms: ${kmap.minterms.join(", ") || "none"}${kmap.dontCares.length ? `; don't-cares: ${kmap.dontCares.join(", ")}` : ""}.`);
  L.push("Step 2 - Group the 1s into the largest power-of-2 rectangles (edges wrap around).");
  for (const id of cover.chosen) {
    const p = primes.find((x) => x.id === id);
    const ess = cover.essential.find((e) => e.id === id);
    const why = p.eliminated.length ? `${p.eliminated.join(", ")} changes inside the group, so it drops out` : "no variable changes, so the term is 1";
    L.push(`${id}: cells ${p.covers.join(", ")} -> ${p.term}. ${why}.${ess ? ` Essential: minterm ${ess.forcedBy} is covered by no other group.` : ""}`);
  }
  L.push(`Step 3 - OR the terms: F = ${cover.expression}`);
  if (cover.alternatives > 1) L.push(`Note: ${cover.alternatives} equally minimal covers exist; this is one of them.`);
  L.push(verification.equivalent ? "Step 4 - Checked against the truth table: it matches." : `Verification failed at minterm ${verification.counterexample.minterm}.`);
  return L.join("\n");
}
