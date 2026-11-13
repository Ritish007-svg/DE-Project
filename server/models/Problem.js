import mongoose from "mongoose";
const schema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    prompt: String,
    mode: String,
    provider: String, // "groq" | "gemini" when mode is "agent"
    reason: String, // why it went offline, when mode is "offline"
    result: mongoose.Schema.Types.Mixed,
    explanation: String,
    trace: mongoose.Schema.Types.Mixed, // agent tool-call trace shown in the UI
  },
  { timestamps: true }
);
export default mongoose.model("Problem", schema);
