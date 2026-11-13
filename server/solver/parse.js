// Offline fallback parser (only used when Gemini fails). Handles:
//   "Σm(1,3,5,7) d(0)"
//   "4 variables minterms 0,1,2 dont cares 5"
//   "Minimise the expression 1,2,3,10"
//   "...high when the inputs are 0, 2, 5 or 7. I don't care what the output does for 1 and 9."
const WORDS = { two: 2, three: 3, four: 4 };
const nums = (s) => (s.match(/\d+/g) || []).map(Number);

export function parseProblem(text) {
  // normalise: drop Σ, curly quotes -> straight, lowercase
  let t = text.replace(/Σ/g, "").replace(/[’‘`]/g, "'").toLowerCase();

  // a K-map problem needs a keyword, or a list of 2+ comma-separated numbers
  const hasKeyword = /\bm\s*\(|\bd\s*\(|minterm|don'?t[\s-]*cares?|do\s+not[\s-]*cares?|\bvariables?\b|\binputs?\b|minimi[sz]e|simplif/.test(t);
  const hasNumberList = /\d+\s*,\s*\d+/.test(t);
  if (!hasKeyword && !hasNumberList) {
    throw new Error("That doesn't look like a K-map problem. Try: Σm(1,3,5,7) d(0), or describe the minterms in words.");
  }

  // variable count: "4 variables", "four inputs", "3-var"
  const varRe = /\b(\d|two|three|four)\s*[- ]?(?:var\w*|input\w*)/;
  const v = t.match(varRe);
  let vars = v ? WORDS[v[1]] ?? Number(v[1]) : null;
  t = t.replace(new RegExp(varRe, "g"), " ");

  // don't cares: explicit d(...) first, otherwise numbers after the
  // "don't care" phrase up to the end of that sentence
  let dontCares = [];
  const explicit = t.match(/\bd\s*\(([^)]*)\)/);
  if (explicit) {
    dontCares = nums(explicit[1]);
    t = t.replace(explicit[0], " ");
  } else {
    const kw = t.match(/(?:don'?t|do\s+not|dont)[\s-]*cares?/);
    if (kw) {
      const after = t.slice(kw.index + kw[0].length);
      const stop = after.search(/[.;\n]/);
      const end = stop === -1 ? after.length : stop;
      dontCares = nums(after.slice(0, end));
      t = t.slice(0, kw.index) + " " + after.slice(end);
    }
  }

  // minterms: m(...) or "minterms ..." (allows "and"/"or"), else any remaining numbers
  const list = "((?:\\d+|,|\\s|and|or|&)+)";
  const m =
    t.match(/\bm\s*\(([^)]*)\)/) ||
    t.match(new RegExp("minterms?\\s*[:=]?\\s*\\(?" + list));
  const minterms = m ? nums(m[1]) : nums(t);
  if (!minterms.length) throw new Error("Could not find minterms. Try: Σm(1,3,5,7) d(0)");

  const max = Math.max(0, ...minterms, ...dontCares);
  if (!vars) vars = Math.min(4, Math.max(2, Math.ceil(Math.log2(max + 1))));

  return { vars, minterms: [...new Set(minterms)], dontCares: [...new Set(dontCares)] };
}