import { GoogleGenAI, Type } from "@google/genai";
import { buildKmap, findPrimeImplicants, selectCover, verifyEquivalence, strip, solveDeterministic, templateExplanation } from "./kmap.js";
import { parseProblem } from "./parse.js";
import { enrich, offlineTrace, looksLikeExpression, exprToMinterms } from "./extras.js";

// Read at call time so it works even if dotenv loads after imports
const getModel = () => process.env.GEMINI_MODEL || "gemini-3.8-flash";

// Thrown when Gemini decides the message is not a K-map problem.
// It is NOT swallowed by the offline fallback; the route shows it to the user.
class Refusal extends Error {}

const declarations = [
  {
    name: "build_kmap",
    description: "Place minterms (1s) and don't-cares on a K-map with Gray-code ordering. Parse the user's input into these arguments.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        vars: { type: Type.INTEGER, description: "Number of variables: 2, 3 or 4" },
        minterms: { type: Type.ARRAY, items: { type: Type.INTEGER } },
        dont_cares: { type: Type.ARRAY, items: { type: Type.INTEGER } },
      },
      required: ["vars", "minterms"],
    },
  },
  { name: "find_prime_implicants", description: "Find all prime implicant groups on the current K-map (wrap-around and don't-cares handled)." },
  { name: "select_cover", description: "Pick essential prime implicants, then the minimal cover. Returns the minimal SOP expression." },
  { name: "verify_equivalence", description: "Check the chosen cover matches the original truth table. Returns a counterexample if not." },
];

const SYSTEM = `You are a Karnaugh-map tutor. You never compute groupings or expressions yourself; you call tools.
Workflow: build_kmap (parse the user's input) -> find_prime_implicants -> select_cover -> verify_equivalence.
If verification fails or a tool returns an error, fix the input and retry.
Then write a short, friendly step-by-step explanation using ONLY tool outputs: how the 1s sit on the Gray-coded grid, each chosen group (cells, and which variable drops out and why), which groups are essential and why, and the final expression. Plain text, no markdown headings, under 250 words.
If the message is not about a Karnaugh map or Boolean minimization, do not call any tools. Reply in one short sentence that you only solve K-map problems and give an example input.`;

// Wraps every tool call so the UI can show an "agent trace" of what the model did.
function runTool(name, input, ctx) {
  const t = { tool: name, input: name === "build_kmap" ? input : undefined };
  (ctx.trace ||= []).push(t);
  try {
    const out = runToolRaw(name, input, ctx);
    t.ok = true;
    t.summary =
      name === "build_kmap" ? `${out.vars} variables, ${out.minterms.length} ones, ${out.dontCares.length} don't-cares`
      : name === "find_prime_implicants" ? `${out.length} prime implicants`
      : name === "select_cover" ? `F = ${out.expression}`
      : out.equivalent ? "matches truth table" : `mismatch at minterm ${out.counterexample?.minterm}`;
    return out;
  } catch (e) {
    t.ok = false;
    t.summary = e.message;
    throw e;
  }
}

function runToolRaw(name, input, ctx) {
  if (name === "build_kmap") {
    ctx.kmap = buildKmap({ vars: input.vars, minterms: input.minterms, dontCares: input.dont_cares || [] });
    ctx.primes = ctx.cover = ctx.verification = null;
    const k = strip(ctx.kmap);
    return { ok: true, vars: k.vars, minterms: k.minterms, dontCares: k.dontCares, rowLabels: k.rowLabels, colLabels: k.colLabels, rowVars: k.rowVars, colVars: k.colVars };
  }
  if (!ctx.kmap) throw new Error("Call build_kmap first");
  if (name === "find_prime_implicants") {
    ctx.primes = findPrimeImplicants(ctx.kmap);
    return ctx.primes.map((p) => ({ id: p.id, term: p.term, cells: p.covers, size: p.size, eliminated: p.eliminated }));
  }
  if (!ctx.primes) throw new Error("Call find_prime_implicants first");
  if (name === "select_cover") {
    ctx.cover = selectCover(ctx.kmap, ctx.primes);
    return ctx.cover;
  }
  if (!ctx.cover) throw new Error("Call select_cover first");
  if (name === "verify_equivalence") {
    ctx.verification = verifyEquivalence(ctx.kmap, ctx.primes, ctx.cover.chosen);
    return ctx.verification;
  }
  throw new Error(`Unknown tool ${name}`);
}

// Retries temporary errors (503 overloaded, 429 rate limit) with backoff,
// then falls back to a second model. Real errors (401, 404...) fail immediately.
async function generateWithRetry(ai, params) {
  const models = [params.model, "gemini-3.8-flash"].filter((m, i, a) => a.indexOf(m) === i);
  let lastErr;
  for (const model of models) {
    try {
      console.log("[solve] using model:", model);
      // give up on this model after 20 seconds instead of hanging
      return await Promise.race([
        ai.models.generateContent({ ...params, model }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout after 20s")), 20000)),
      ]);
    } catch (e) {
      lastErr = e;
      console.error(`[solve] ${model} failed:`, e.status || "", e.message.slice(0, 120));
      // 401 / 400 / 404 are real errors, so stop and don't try another model
      if (e.status && e.status !== 503 && e.status !== 429) throw e;
      // 503, 429 or timeout: move on to the next model
    }
  }
  throw lastErr;
}
// ---------- Groq (OpenAI-compatible API, plain fetch, no extra package) ----------
const getGroqModel = () => process.env.GROQ_MODEL || "openai/gpt-oss-120b";

const groqTools = declarations.map((d) => ({
  type: "function",
  function: {
    name: d.name,
    description: d.description,
    parameters: d.parameters
      ? {
          type: "object",
          properties: {
            vars: { type: "integer", description: "Number of variables: 2, 3 or 4" },
            minterms: { type: "array", items: { type: "integer" } },
            dont_cares: { type: "array", items: { type: "integer" } },
          },
          required: ["vars", "minterms"],
        }
      : { type: "object", properties: {} },
  },
}));

async function groqChat(messages) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({ model: getGroqModel(), messages, tools: groqTools, tool_choice: "auto", temperature: 0.2 }),
      signal: ctrl.signal,
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`Groq ${r.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text);
  } catch (e) {
    if (e.name === "AbortError") throw new Error("Groq timeout after 30s");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function runGroq(prompt, ctx) {
  const messages = [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }];
  for (let i = 0; i < 10; i++) {
    const data = await groqChat(messages);
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error("Groq returned no message");
    messages.push(msg);
    const calls = msg.tool_calls || [];
    console.log(`[solve] groq turn ${i + 1}: tool calls =`, calls.map((c) => c.function.name));
    if (!calls.length) return msg.content || "";
    for (const c of calls) {
      let out;
      try {
        out = runTool(c.function.name, JSON.parse(c.function.arguments || "{}"), ctx);
      } catch (e) {
        console.error(`[solve] tool ${c.function.name} failed:`, e.message);
        out = { error: e.message };
      }
      messages.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(out) });
    }
  }
  return "";
}

// ---------- Gemini ----------
async function runGemini(prompt, ctx) {
  const model = getModel();
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const contents = [{ role: "user", parts: [{ text: prompt }] }];
  for (let i = 0; i < 10; i++) {
    const res = await generateWithRetry(ai, {
      model,
      contents,
      config: { systemInstruction: SYSTEM, tools: [{ functionDeclarations: declarations }] },
    });
    const calls = res.functionCalls || [];
    const content = res.candidates?.[0]?.content;
    if (!content) {
      throw new Error(`Gemini returned no content (finishReason: ${res.candidates?.[0]?.finishReason || "unknown"})`);
    }
    contents.push(content);
    console.log(`[solve] gemini turn ${i + 1}: tool calls =`, calls.map((c) => c.name));
    if (!calls.length) return res.text || "";
    const parts = calls.map((c) => {
      try {
        return { functionResponse: { name: c.name, response: { output: runTool(c.name, c.args || {}, ctx) } } };
      } catch (e) {
        console.error(`[solve] tool ${c.name} failed:`, e.message);
        return { functionResponse: { name: c.name, response: { error: e.message } } };
      }
    });
    contents.push({ role: "user", parts });
  }
  return "";
}

// Providers are tried in order; the first that gives a verified result wins.
export async function solve(rawPrompt) {
  // A plain Boolean expression like A'B + AB'C is converted to minterms first (deterministic, no LLM needed)
  let prompt = rawPrompt;
  if (looksLikeExpression(rawPrompt)) {
    try {
      const e = exprToMinterms(rawPrompt);
      if (e.minterms.length) prompt = `${e.vars} variables, Σm(${e.minterms.join(",")})`;
    } catch (err) {
      throw new Error(err.message);
    }
  }
  const providers = [];
  if (process.env.GROQ_API_KEY) providers.push({ name: "groq", run: runGroq });
  if (process.env.GEMINI_API_KEY) providers.push({ name: "gemini", run: runGemini });
  console.log("[solve] providers available:", providers.map((p) => p.name));

  const reasons = [];
  for (const p of providers) {
    try {
      const ctx = {};
      const explanation = await p.run(prompt, ctx);

      // Model answered in plain text without ever building a K-map: off-topic message
      if (!ctx.kmap && explanation.trim()) throw new Refusal(explanation.trim());

      if (ctx.verification?.equivalent) {
        return {
          mode: "agent",
          provider: p.name,
          result: enrich({ kmap: strip(ctx.kmap), primes: ctx.primes, cover: ctx.cover, verification: ctx.verification }),
          explanation,
          trace: ctx.trace || [],
        };
      }
      reasons.push(`${p.name}: did not produce a verified result`);
      console.error(`[solve] ${p.name} no verified result. State:`, {
        kmap: !!ctx.kmap, primes: !!ctx.primes, cover: !!ctx.cover, verification: ctx.verification || null,
      });
    } catch (e) {
      if (e instanceof Refusal) throw e;
      reasons.push(`${p.name}: ${e.message}`);
      console.error(`[solve] ${p.name} failed, trying next:`, e.message);
    }
  }

  // Fallback: no key, quota exhausted, network error, or verification never passed
  const reason = reasons.length ? reasons.join(" | ") : "no API key set";
  const result = solveDeterministic(parseProblem(prompt));
  return { mode: "offline", reason, result: enrich(result), explanation: templateExplanation(result), trace: offlineTrace(result) };
}
