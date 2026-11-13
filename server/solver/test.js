import assert from "node:assert";
import { solveDeterministic } from "./kmap.js";
import { parseProblem } from "./parse.js";

const t = (vars, minterms, dontCares = []) => solveDeterministic({ vars, minterms, dontCares }).cover.expression;
assert.equal(t(3, [1, 3, 5, 7]), "C");
assert.equal(t(4, [0, 1, 2, 5, 8, 9, 10]).split(" + ").sort().join(" + "), ["A'C'D", "B'C'", "B'D'"].sort().join(" + "));
assert.equal(t(2, []), "0");
assert.equal(t(2, [0, 1, 2, 3]), "1");
assert.deepEqual(parseProblem("Σm(1,3,5,7) d(0)"), { vars: 3, minterms: [1, 3, 5, 7], dontCares: [0] });
for (let i = 0; i < 500; i++) {
  const vars = 2 + (i % 3), size = 1 << vars, minterms = [], dontCares = [];
  for (let m = 0; m < size; m++) { const r = Math.random(); if (r < 0.4) minterms.push(m); else if (r < 0.55) dontCares.push(m); }
  assert(solveDeterministic({ vars, minterms, dontCares }).verification.equivalent, JSON.stringify({ vars, minterms, dontCares }));
}
console.log("solver tests passed");


const cases = [
  ["I have a circuit with four inputs, A, B, C and D. The output should be high when the inputs are 0, 2, 5, 7, 8, 10, 13 or 15 (read as binary numbers). I don't care what the output does for 1 and 9. What's the simplest expression for the output", "B'D' + BD"],
  ["Σm(0,2,5,7,8,10,13,15) + d(1,9)", "B'D' + BD"],
  ["4 variables, minterms 0,2,5,7,8,10,13,15, don't cares 1,9", "B'D' + BD"],
];

for (const [text, want] of cases) {
  const p = parseProblem(text);
  const got = solveDeterministic(p).cover.expression;
  console.log(got === want ? "PASS" : "FAIL", JSON.stringify(p), "->", got);
}
// ---- extras ----
import { exprToMinterms, looksLikeExpression, enrich, solvePOS, checkAnswer } from "./extras.js";
import { buildKmap } from "./kmap.js";
assert.deepEqual(exprToMinterms("A'B + AB'C").minterms, [2, 3, 5]);
assert.deepEqual(exprToMinterms("F(A,B,C) = (A+B)'", 3).minterms, [0, 1]);
assert(looksLikeExpression("A'B + C") && !looksLikeExpression("1,2,3") && !looksLikeExpression("bad"));
assert.equal(solvePOS(buildKmap({ vars: 2, minterms: [1, 2, 3] })).expression, "A + B");
const e = enrich(solveDeterministic({ vars: 4, minterms: [0, 1, 2, 5, 8, 9, 10] }));
assert(e.steps.length >= 6 && e.circuit.terms.length === 3 && e.pos.expression && e.nand.startsWith("NAND"));
assert.equal(checkAnswer({ vars: 3, minterms: [1, 3, 5, 7], expression: "C" }).minimal, true);
assert.equal(checkAnswer({ vars: 3, minterms: [1, 3, 5, 7], expression: "A'C + AC" }).minimal, false);
assert.equal(checkAnswer({ vars: 3, minterms: [1, 3, 5, 7], expression: "B" }).correct, false);
// hazard: F = A'B + AC (m3,m7 ... ) classic static-1 hazard
const h = enrich(solveDeterministic({ vars: 3, minterms: [2, 3, 5, 7] }));
console.log("hazards for Σm(2,3,5,7):", JSON.stringify(h.hazards), "POS:", h.pos.expression, h.nand);
console.log("extras tests passed");
