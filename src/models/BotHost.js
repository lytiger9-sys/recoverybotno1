import mongoose from "mongoose";

const encryptedSecretSchema = new mongoose.Schema({
  ciphertext: String,
  iv: String,
  authTag: String,
}, { _id: false });

const botHostSchema = new mongoose.Schema({
  name: String,
  clientId: String,
  clientSecret: encryptedSecretSchema,
  botToken: encryptedSecretSchema,
  enabled: Boolean,
  runtimeHeartbeatAt: Date,
  runtimeUsername: String,
}, { timestamps: true, strict: false, autoIndex: false });

export const BotHost = mongoose.models.BotHost ?? mongoose.model("BotHost", botHostSchema);
