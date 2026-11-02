import mongoose from "mongoose";
const schema = new mongoose.Schema({
  status: String, activeRequestId: mongoose.Schema.Types.ObjectId, completedAt: Date,
  recoverySucceeded: Number, recoveryTotal: Number, failureReason: String,
}, { collection: "licenses", autoIndex: false, strict: false });
export const License = mongoose.models.License ?? mongoose.model("License", schema);

