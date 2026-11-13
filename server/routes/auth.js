import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";

const r = Router();
const sign = (u) => jwt.sign({ id: u._id }, process.env.JWT_SECRET, { expiresIn: "7d" });

r.post("/register", async (req, res) => {
  const { email: rawEmail, password } = req.body || {};
  const email = String(rawEmail || "").trim().toLowerCase();
  if (!email || !password || password.length < 6) return res.status(400).json({ error: "Enter an email and a password of at least 6 characters." });
  if (await User.findOne({ email })) return res.status(409).json({ error: "That email is already registered." });
  const user = await User.create({ email, password: await bcrypt.hash(password, 10) });
  res.json({ token: sign(user), email: user.email });
});

r.post("/login", async (req, res) => {
  const { email: rawEmail, password } = req.body || {};
  const email = String(rawEmail || "").trim().toLowerCase();
  const user = await User.findOne({ email });
  if (!user || !(await bcrypt.compare(password || "", user.password))) return res.status(401).json({ error: "Wrong email or password." });
  res.json({ token: sign(user), email: user.email });
});


export default r;
