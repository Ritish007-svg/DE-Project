import dns from "node:dns";
dns.setServers(["8.8.8.8", "1.1.1.1"]);

import dotenv from "dotenv";
dotenv.config({ override: true });
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import authRoutes from "./routes/auth.js";
import kmapRoutes from "./routes/kmap.js";

const app = express();
app.use(cors({ methods: ["GET", "POST", "DELETE", "OPTIONS"] }));
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/kmap", kmapRoutes);
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

await mongoose.connect(process.env.MONGO_URI);
console.log("Mongo connected");
app.listen(process.env.PORT || 5000, () => console.log("API on :" + (process.env.PORT || 5000)));