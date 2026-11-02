import "dotenv/config";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("Missing required environment variable: " + name);
  return value;
}

const encryptionKey = Buffer.from(required("TOKEN_ENCRYPTION_KEY"), "base64");
if (encryptionKey.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
const hostId = required("HOST_ID").toLowerCase();
if (!/^[a-f\d]{24}$/i.test(hostId)) throw new Error("HOST_ID must be a MongoDB ObjectId.");

function requiredUrl(name) {
  const value = required(name).replace(/\/$/, "");
  let url;
  try { url = new URL(value); } catch { throw new Error(name + " must be a valid URL."); }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") throw new Error(name + " must use HTTPS in production.");
  return value;
}

export const config = Object.freeze({
  mongodbUri: required("MONGODB_URI"),
  tokenEncryptionKey: encryptionKey,
  hostId,
  publicBaseUrl: requiredUrl("PUBLIC_BASE_URL"),
});
