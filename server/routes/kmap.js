import { Router } from "express";
import mongoose from "mongoose";
import auth from "../middleware/auth.js";
import Problem from "../models/Problem.js";
import { solve } from "../solver/agent.js";
import { solveDeterministic, templateExplanation } from "../solver/kmap.js";
import { enrich, offlineTrace, randomProblem, checkAnswer } from "../solver/extras.js";

const r = Router();
r.use(auth);

r.post("/solve", async (req, res) => {
  const prompt = (req.body?.prompt || "").slice(0, 500).trim();
  if (!prompt) return res.status(400).json({ error: "Describe the function, e.g. Σm(1,3,5,7)." });
  try {
    const out = await solve(prompt);
    const saved = await Problem.create({ user: req.userId, prompt, ...out });
    res.json({ id: saved._id, prompt, ...out });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

r.get("/history", async (req, res) => {
  const items = await Problem.find({ user: req.userId }).sort({ createdAt: -1 }).limit(20);
  res.json(items);
});

r.delete("/history/:id", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid chat id." });
    }
    // same model and owner field as GET /history, so users can only delete their own chats
    const doc = await Problem.findOneAndDelete({ _id: req.params.id, user: req.userId });
    if (!doc) return res.status(404).json({ error: "Chat not found." });
    res.json({ ok: true });
  } catch (e) {
    console.error("Delete failed:", e.message);
    res.status(500).json({ error: "Could not delete chat." });
  }
});

// ---- K-map editor: the user clicks cells, solved deterministically (no LLM) ----
const intList = (a) => (Array.isArray(a) ? a.map(Number) : []);

r.post("/solve-direct", async (req, res) => {
  try {
    const vars = Number(req.body?.vars);
    const minterms = intList(req.body?.minterms);
    const dontCares = intList(req.body?.dontCares);
    const raw = solveDeterministic({ vars, minterms, dontCares });
    const result = enrich(raw);
    const prompt = `Editor: ${vars}-var map, Σm(${minterms.join(",")})${dontCares.length ? ` d(${dontCares.join(",")})` : ""}`;
    const out = { mode: "direct", result, explanation: templateExplanation(raw), trace: offlineTrace(raw) };
    const saved = await Problem.create({ user: req.userId, prompt, ...out });
    res.json({ id: saved._id, prompt, ...out });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- Practice quiz ----
r.get("/quiz", (req, res) => {
  const vars = [2, 3, 4].includes(Number(req.query.vars)) ? Number(req.query.vars) : 3;
  res.json(randomProblem(vars));
});

r.post("/quiz/check", (req, res) => {
  try {
    const vars = Number(req.body?.vars);
    const minterms = intList(req.body?.minterms);
    const dontCares = intList(req.body?.dontCares);
    const expression = String(req.body?.expression || "").slice(0, 200);
    let out = {};
    if (!req.body?.giveUp) out = checkAnswer({ vars, minterms, dontCares, expression });
    if (req.body?.giveUp || out.correct) {
      const raw = solveDeterministic({ vars, minterms, dontCares });
      out.solution = { result: enrich(raw), explanation: templateExplanation(raw) };
    }
    res.json(out);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default r;