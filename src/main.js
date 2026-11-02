import { config } from "./config.js";
import { connectDatabase, disconnectDatabase } from "./database.js";
import { BotHost } from "./models/BotHost.js";
import { decryptSecret } from "./security/secretEncryption.js";
import { startHostBot } from "./discord/HostBot.js";
import { startHealthServer } from "./health/HealthServer.js";

await connectDatabase(config.mongodbUri);
let runtime;
let currentFingerprint = "";
const stopHealthServer = await startHealthServer(() => runtime);

async function stopRuntime() {
  await runtime?.stop();
  runtime = undefined;
  currentFingerprint = "";
}

async function syncHostRuntime() {
  const host = await BotHost.findById(config.hostId).lean();
  if (!host) throw new Error("HOST_ID에 해당하는 호기 설정이 MongoDB에 없습니다.");
  if (!host.enabled) {
    await stopRuntime();
    await BotHost.updateOne({ _id: host._id }, { $set: { runtimeHeartbeatAt: null, runtimeUsername: "" } });
    return;
  }

  const fingerprint = JSON.stringify({ name: host.name, clientId: host.clientId, clientSecret: host.clientSecret, botToken: host.botToken });
  if (runtime && currentFingerprint === fingerprint) return;

  await stopRuntime();
  const botToken = decryptSecret(host.botToken, config.tokenEncryptionKey);
  try {
    runtime = await startHostBot(host, botToken);
    currentFingerprint = fingerprint;
  } catch (error) {
    await BotHost.updateOne({ _id: host._id }, { $set: { runtimeHeartbeatAt: null, runtimeUsername: "" } }).catch(() => {});
    throw error;
  }
}

await syncHostRuntime();
const configRefreshTimer = setInterval(() => {
  void syncHostRuntime().catch((error) => console.error("Host settings refresh failed:", error?.name ?? "UnknownError"));
}, 15_000);
configRefreshTimer.unref?.();

async function shutdown() {
  clearInterval(configRefreshTimer);
  await stopRuntime();
  await stopHealthServer();
  await disconnectDatabase();
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
