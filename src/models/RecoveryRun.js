import mongoose from "mongoose";

const schema = new mongoose.Schema({
  hostIds: [{ type: mongoose.Schema.Types.ObjectId }],
  licenseId: { type: mongoose.Schema.Types.ObjectId, default: null },
  licenseApprovalRequestId: { type: mongoose.Schema.Types.ObjectId, default: null },
  targetGuildId: { type: String, required: true },
  status: { type: String, enum: ["QUEUED", "RUNNING", "COMPLETED", "FAILED"], default: "QUEUED" },
  total: { type: Number, default: 0 }, processed: { type: Number, default: 0 },
  succeeded: { type: Number, default: 0 }, alreadyMember: { type: Number, default: 0 }, failed: { type: Number, default: 0 },
  failureReasons: { type: Map, of: Number, default: () => new Map() },
  currentHostName: { type: String, default: "" }, currentHostId: { type: mongoose.Schema.Types.ObjectId, default: null },
  delayMs: { type: Number, default: 2000 }, estimatedRemainingSeconds: { type: Number, default: 0 },
  message: { type: String, default: "" }, startedAt: Date, completedAt: Date,
}, { timestamps: true, autoIndex: false, strict: false });
export const RecoveryRun = mongoose.models.RecoveryRun ?? mongoose.model("RecoveryRun", schema);

