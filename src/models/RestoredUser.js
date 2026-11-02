import mongoose from "mongoose";

const schema = new mongoose.Schema({
  hostId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  discordUserId: { type: String, required: true },
  username: { type: String, required: true },
  accessToken: { type: mongoose.Schema.Types.Mixed, required: true },
  refreshToken: { type: mongoose.Schema.Types.Mixed, required: true },
  email: { type: mongoose.Schema.Types.Mixed, default: undefined },
  status: { type: String, enum: ["ACTIVE", "INACTIVE", "REVOKED"], default: "ACTIVE" },
  lastUpdated: { type: Date, required: true },
  tokenExpiresAt: Date,
}, { timestamps: true, autoIndex: false, strict: false });
schema.index({ hostId: 1, discordUserId: 1 }, { unique: true });
export const RestoredUser = mongoose.models.RestoredUser ?? mongoose.model("RestoredUser", schema);

