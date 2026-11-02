import mongoose from "mongoose";

const schema = new mongoose.Schema({
  runId: { type: mongoose.Schema.Types.ObjectId, required: true },
  hostId: { type: mongoose.Schema.Types.ObjectId, required: true },
  sequence: { type: Number, required: true },
  status: { type: String, enum: ["WAITING", "QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"], default: "WAITING" },
  processed: { type: Number, default: 0 }, succeeded: { type: Number, default: 0 },
  alreadyMember: { type: Number, default: 0 }, failed: { type: Number, default: 0 },
  heartbeatAt: { type: Date, default: null }, startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null }, failureReason: { type: String, default: "" },
}, { timestamps: true, autoIndex: false, strict: false });
schema.index({ runId: 1, hostId: 1 }, { unique: true });
schema.index({ hostId: 1, status: 1, createdAt: 1, sequence: 1 });
export const RecoveryHostTask = mongoose.models.RecoveryHostTask ?? mongoose.model("RecoveryHostTask", schema);

