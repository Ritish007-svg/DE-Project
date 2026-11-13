// Extra deterministic features layered on top of kmap.js (kmap.js is untouched):
//   - Boolean expression input  (A'B + AB'C  ->  minterms)
//   - tutor steps for the step-through walkthrough
//   - POS (product of sums) minimisation
//   - NAND-only / NOR-only forms
//   - static-1 hazard detection
//   - circuit data for the gate diagram
//   - random practice problems and answer checking (quiz)
import { buildKmap, findPrimeImplicants, selectCover, solveDeterministic } from "./kmap.js";

const NAMES = ["A", "B", "C", "D"];

/* ---------------- Boolean expression parser ---------------- */
function tokenize(src) {
  const toks = [];
  for (const ch of src.toUpperCase()) {
    if (/\s/.test(ch)) continue;
    if (/[A-D01'!~+*.&|()]/.test(ch)) toks.push(ch === "~" ? "!" : ch === "|" ? "+" : ch === "&" || ch === "." ? "*" : ch);
    else throw new Error(`Unexpected character "${ch}" in expression (use variables A-D, +, ', parentheses).`);
  }
  return toks;
}

// Returns { fn(assignment) , maxVar } where assignment is an object {A:0/1,...}
function parseExpr(src) {
  const toks = tokenize(src);
  let i = 0, maxVar = -1;
  const peek = () => toks[i];
  const startsFactor = (t) => t && (/[A-D01]/.test(t) || t === "(" || t === "!");

  function or() {
    let left = and();
    while (peek() === "+") { i++; const l = left, r = and(); left = (e) => l(e) | r(e); }
    return left;
  }
  function and() {
    let left = not();
    while (peek() === "*" || startsFactor(peek())) {
      if (peek() === "*") i++;
      const l = left, r = not();
      left = (e) => l(e) & r(e);
    }
    return left;
  }
  function not() {
    if (peek() === "!") { i++; const f = not(); return (e) => 1 - f(e); }
    let f = atom();
    while (peek() === "'") { i++; const g = f; f = (e) => 1 - g(e); }
    return f;
  }
  function atom() {
    const t = toks[i++];
    if (t === undefined) throw new Error("Expression ended unexpectedly.");
    if (t === "(") {
      const f = or();
      if (toks[i++] !== ")") throw new Error("Missing closing parenthesis.");
      return f;
    }
    if (t === "0" || t === "1") return () => Number(t);
    if (/[A-D]/.test(t)) { maxVar = Math.max(maxVar, NAMES.indexOf(t)); return (e) => e[t]; }
    throw new Error(`Unexpected "${t}" in expression.`);
  }
  const fn = or();
  if (i < toks.length) throw new Error(`Unexpected "${toks[i]}" in expression.`);
  return { fn, maxVar };
}

// Evaluate over `vars` variables. If vars is omitted it is inferred from the highest letter used (min 2).
export function exprToMinterms(src, vars) {
  const { fn, maxVar } = parseExpr(src.replace(/^\s*f\s*(\([^)]*\))?\s*=\s*/i, ""));
  const n = vars || Math.max(2, maxVar + 1);
  if (maxVar >= n) throw new Error(`The expression uses ${NAMES[maxVar]}, which is outside a ${n}-variable map.`);
  const minterms = [];
  for (let m = 0; m < 1 << n; m++) {
    const env = {};
    NAMES.slice(0, n).forEach((nm, k) => (env[nm] = (m >> (n - 1 - k)) & 1));
    if (fn(env)) minterms.push(m);
  }
  return { vars: n, minterms };
}

export function looksLikeExpression(prompt) {
  const t = prompt.trim().replace(/^f\s*(\([^)]*\))?\s*=\s*/i, "");
  return /^[A-Da-d01'!~+*.&|()\s]+$/.test(t) && /[A-Da-d]/.test(t) && /['!~+*&|()]/.test(t);
}

/* ---------------- helpers ---------------- */
const literalsOf = (p, names) => {
  const n = names.length;
  const out = [];
  names.forEach((v, i) => {
    const bit = 1 << (n - 1 - i);
    if (!(p.mask & bit)) out.push({ v, neg: !(p.value & bit) });
  });
  return out;
};
const lit = (l) => l.v + (l.neg ? "'" : "");

function wraps(cells, R, C) {
  const rows = new Set(cells.map((c) => c.r)), cols = new Set(cells.map((c) => c.c));
  const edge = (s, N) => N > 2 && s.size < N && s.has(0) && s.has(N - 1);
  return edge(rows, R) || edge(cols, C);
}

/* ---------------- POS ---------------- */
export function solvePOS(kmap) {
  const all = Array.from({ length: 1 << kmap.vars }, (_, m) => m);
  const zeros = all.filter((m) => !kmap.minterms.includes(m) && !kmap.dontCares.includes(m));
  if (!kmap.minterms.length) return { expression: "0", sums: [] };
  if (!zeros.length) return { expression: "1", sums: [] };
  const km = buildKmap({ vars: kmap.vars, minterms: zeros, dontCares: kmap.dontCares });
  const primes = findPrimeImplicants(km);
  const cover = selectCover(km, primes);
  const sums = cover.chosen.map((id) => literalsOf(primes.find((p) => p.id === id), km.names).map((l) => ({ v: l.v, neg: !l.neg })));
  const text = sums.map((s) => s.map(lit).join(" + "));
  const expression = text.length === 1 ? text[0] : text.map((t) => `(${t})`).join("");
  return { expression, sums: sums.map((s) => s.map(lit)) };
}

/* ---------------- hazards ---------------- */
function findHazards(kmap, primes, cover) {
  const chosen = cover.chosen.map((id) => primes.find((p) => p.id === id));
  const ones = kmap.minterms;
  const out = [];
  for (let x = 0; x < ones.length; x++)
    for (let y = x + 1; y < ones.length; y++) {
      const a = ones[x], b = ones[y], d = a ^ b;
      if (!d || d & (d - 1)) continue; // not adjacent
      if (chosen.some((p) => p.covers.includes(a) && p.covers.includes(b))) continue;
      const fix = primes.filter((p) => p.covers.includes(a) && p.covers.includes(b)).sort((p, q) => q.size - p.size)[0];
      out.push({
        a, b,
        groups: chosen.filter((p) => p.covers.includes(a) || p.covers.includes(b)).map((p) => p.id),
        fixTerm: fix ? fix.term : null,
      });
    }
  return out;
}

/* ---------------- tutor steps ---------------- */
function buildSteps(kmap, primes, cover, verification, pos) {
  const R = kmap.rowLabels.length, C = kmap.colLabels.length;
  const steps = [];
  const chosen = cover.chosen.map((id) => primes.find((p) => p.id === id));
  steps.push({
    title: "Draw the K-map",
    text: `${kmap.vars} variables give ${1 << kmap.vars} cells. Rows are ${kmap.rowVars}, columns are ${kmap.colVars}. The labels are in Gray-code order (${kmap.colLabels.join(", ")}), so two neighbouring cells differ in exactly one variable. That is what makes grouping possible, and the first and last row/column are neighbours too.`,
    show: "empty", groups: [],
  });
  steps.push({
    title: "Place the 1s",
    text: `Put 1 in the cells of the minterms: ${kmap.minterms.join(", ") || "none"}.${kmap.dontCares.length ? ` Put X in the don't-care cells ${kmap.dontCares.join(", ")}; we may treat an X as 1 if it helps make a bigger group.` : ""} All other cells are 0.`,
    show: "ones", groups: [],
  });
  const big = primes.length ? Math.max(...primes.map((p) => p.size)) : 0;
  steps.push({
    title: "Find the largest groups",
    text: `Groups must be rectangles of 1, 2, 4, 8 or 16 cells. A bigger group removes more variables and gives a shorter term. This map has ${primes.length} maximal group(s) (prime implicants); the largest has ${big} cell(s). Next we choose the ones we need.`,
    show: "ones", groups: [],
  });
  const shown = [];
  chosen.forEach((p) => {
    shown.push(p.id);
    const ess = cover.essential.find((e) => e.id === p.id);
    const wrap = wraps(p.cells, R, C) ? " It wraps around the edge of the map." : "";
    const why = p.eliminated.length
      ? `Inside this group ${p.eliminated.join(" and ")} take${p.eliminated.length === 1 ? "s" : ""} both values 0 and 1, so ${p.eliminated.length === 1 ? "it drops" : "they drop"} out. What stays constant gives the term ${p.term}.`
      : "No variable changes inside the group (it covers the whole map), so the term is 1.";
    steps.push({
      title: `Group ${p.id}: ${p.term}`,
      text: `Cells ${p.covers.join(", ")} (${p.size} cell${p.size > 1 ? "s" : ""}).${wrap} ${why}${ess ? ` It is ESSENTIAL: minterm ${ess.forcedBy} is covered by no other group, so we must keep it.` : " It is not essential, but it is needed to cover the remaining 1s with the fewest groups."}`,
      show: "ones", groups: [...shown],
    });
  });
  const dropped = primes.filter((p) => !cover.chosen.includes(p.id));
  if (dropped.length)
    steps.push({
      title: "Groups we leave out",
      text: `${dropped.map((p) => `${p.id} (${p.term})`).join(", ")} ${dropped.length === 1 ? "is" : "are"} valid but redundant: all of ${dropped.length === 1 ? "its" : "their"} 1s are already covered by the chosen groups, so adding ${dropped.length === 1 ? "it" : "them"} would only make the circuit bigger.`,
      show: "ones", groups: [...shown],
    });
  steps.push({
    title: "OR the terms together",
    text: `F = ${cover.expression}${cover.alternatives > 1 ? `. (${cover.alternatives} equally small covers exist; this is one of them.)` : ""}. Product of sums form (grouping the 0s instead): F = ${pos.expression}.`,
    show: "ones", groups: [...shown],
  });
  steps.push({
    title: "Verify",
    text: verification.equivalent
      ? "The expression was checked against every row of the truth table (ignoring don't-cares) and matches."
      : `Verification failed at minterm ${verification.counterexample.minterm}.`,
    show: "ones", groups: [...shown],
  });
  return steps;
}

/* ---------------- enrich: add everything to a solved result ---------------- */
export function enrich(r) {
  try {
    const km = buildKmap({ vars: r.kmap.vars, minterms: r.kmap.minterms, dontCares: r.kmap.dontCares });
    const pos = solvePOS(km);
    const chosen = r.cover.chosen.map((id) => r.primes.find((p) => p.id === id));
    const terms = chosen.map((p) => ({ id: p.id, term: p.term, literals: literalsOf(p, km.names) }));
    const nandText = !r.kmap.minterms.length ? "0" : `NAND( ${terms.map((t) => (t.literals.length ? `NAND(${t.literals.map(lit).join(", ")})` : "0")).join(", ")} )`;
    const norText = pos.sums.length ? `NOR( ${pos.sums.map((s) => `NOR(${s.join(", ")})`).join(", ")} )` : pos.expression;
    return {
      ...r,
      pos,
      circuit: { names: km.names, terms },
      nand: nandText,
      nor: norText,
      hazards: findHazards(km, r.primes, r.cover),
      steps: buildSteps(km, r.primes, r.cover, r.verification, pos),
    };
  } catch (e) {
    console.error("[enrich] skipped:", e.message);
    return r;
  }
}

export function offlineTrace(r) {
  return [
    { tool: "build_kmap", ok: true, summary: `${r.kmap.vars} variables, ${r.kmap.minterms.length} ones, ${r.kmap.dontCares.length} don't-cares` },
    { tool: "find_prime_implicants", ok: true, summary: `${r.primes.length} prime implicants` },
    { tool: "select_cover", ok: true, summary: `F = ${r.cover.expression}` },
    { tool: "verify_equivalence", ok: r.verification.equivalent, summary: r.verification.equivalent ? "matches truth table" : "mismatch" },
  ];
}

/* ---------------- quiz ---------------- */
export function randomProblem(vars) {
  const size = 1 << vars;
  for (;;) {
    const minterms = [], dontCares = [];
    for (let m = 0; m < size; m++) {
      const x = Math.random();
      if (x < 0.42) minterms.push(m);
      else if (x < 0.52) dontCares.push(m);
    }
    if (minterms.length >= 2 && minterms.length + dontCares.length < size) return { vars, minterms, dontCares };
  }
}

const countLits = (s) => (s.match(/[A-D]/gi) || []).length;

export function checkAnswer({ vars, minterms, dontCares = [], expression }) {
  const user = exprToMinterms(expression, vars);
  const sol = solveDeterministic({ vars, minterms, dontCares });
  for (let m = 0; m < 1 << vars; m++) {
    if (dontCares.includes(m)) continue;
    const want = minterms.includes(m) ? 1 : 0, got = user.minterms.includes(m) ? 1 : 0;
    if (want !== got)
      return { correct: false, feedback: `Not equal to the function: at minterm ${m} your expression gives ${got} but it should be ${want}.`, counterexample: { minterm: m, expected: want, got } };
  }
  const best = sol.primes.length ? sol.cover.chosen.map((id) => sol.primes.find((p) => p.id === id).term) : [];
  const bestLits = best.reduce((s, t) => s + countLits(t), 0);
  const plain = !/[()!]/.test(expression);
  const mine = plain ? countLits(expression) : null;
  const minimal = mine === null ? null : mine <= bestLits && expression.split("+").length <= best.length;
  return {
    correct: true,
    minimal,
    feedback:
      minimal === false
        ? `Correct, but not fully minimised: your answer uses ${mine} literals, the minimal one uses ${bestLits}. Look for bigger groups.`
        : minimal
        ? "Correct and fully minimised. Well done!"
        : "Correct: your expression matches the function. (It has brackets, so I could not count its size.)",
    minimalExpression: sol.cover.expression,
  };
}
