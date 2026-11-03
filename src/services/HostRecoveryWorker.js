import { BotHost } from "../models/BotHost.js";
import { License } from "../models/License.js";
import { RecoveryHostTask } from "../models/RecoveryHostTask.js";
import { RecoveryRun } from "../models/RecoveryRun.js";
import { RestoredUser } from "../models/RestoredUser.js";
import { config } from "../config.js";
import { decryptSecret } from "../security/secretEncryption.js";

const API = "https://discord.com/api/v10";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let working = false;

class WorkerStop extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

async function discordRequest(url, options, retries = 4) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const response = await fetch(url, options);
    if (response.status !== 429 || attempt === retries) return response;
    const body = await response.json().catch(() => ({}));
    await pause(Math.max(250, Math.ceil(Number(body.retry_after ?? 1) * 1000)));
  }
}

const botHeaders = (token) => ({ Authorization: "Bot " + token });
const storedPlaintext = (value) => typeof value === "string" ? value : decryptSecret(value, config.tokenEncryptionKey);

async function assertGuildReady(guildId, token, client) {
  if (!client.isReady()) throw new WorkerStop("host_offline", "호기 봇이 오프라인이 되어 복구를 중단했습니다.");
  const guildResponse = await discordRequest(API + "/guilds/" + guildId, { headers: botHeaders(token) });
  if (guildResponse.status === 429) throw new WorkerStop("discord_429", "대상 서버 확인 중 Discord 요청 제한이 지속되어 중단했습니다.");
  if (guildResponse.status === 401) throw new WorkerStop("host_auth_failed", "호기 봇 토큰 인증에 실패했습니다.");
  if (!guildResponse.ok) throw new WorkerStop("host_left_guild", "호기 봇이 대상 서버에 없거나 서버를 확인할 수 없습니다.");
  const guild = await guildResponse.json();
  const meResponse = await discordRequest(API + "/users/@me", { headers: botHeaders(token) });
  if (!meResponse.ok) throw new WorkerStop("host_auth_failed", "호기 봇 토큰 인증에 실패했습니다.");
  const me = await meResponse.json();
  const memberResponse = await discordRequest(API + "/guilds/" + guildId + "/members/" + me.id, { headers: botHeaders(token) });
  if (!memberResponse.ok) throw new WorkerStop("host_left_guild", "호기 봇이 대상 서버에 없습니다.");
  const member = await memberResponse.json();
  let roleList = guild.roles;
  if (!Array.isArray(roleList) || roleList.length === 0) {
    const rolesResponse = await discordRequest(API + "/guilds/" + guildId + "/roles", { headers: botHeaders(token) });
    if (!rolesResponse.ok) throw new WorkerStop("bot_permission_lost", "호기 봇의 서버 역할 권한을 확인할 수 없습니다.");
    roleList = await rolesResponse.json();
  }
  const roles = new Map(roleList.map((role) => [role.id, BigInt(role.permissions)]));
  const permissions = [guild.id, ...(member.roles ?? [])].reduce((bits, roleId) => bits | (roles.get(roleId) ?? 0n), 0n);
  if ((permissions & 8n) !== 8n && (permissions & 1n) !== 1n) {
    throw new WorkerStop("bot_permission_lost", "호기 봇에 멤버 추가에 필요한 권한이 없습니다.");
  }
}

async function refreshUserToken(host, user) {
  const secret = decryptSecret(host.clientSecret, config.tokenEncryptionKey);
  const refresh = storedPlaintext(user.refreshToken);
  const response = await discordRequest(API + "/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(host.clientId + ":" + secret).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh }),
  });
  if (response.status === 429) throw new WorkerStop("discord_429", "OAuth 토큰 갱신 제한이 지속되어 복구를 중단했습니다.");
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token || !data.refresh_token) {
    await RestoredUser.updateOne({ _id: user._id }, { $set: { status: "REVOKED" } });
    return null;
  }
  await RestoredUser.updateOne({ _id: user._id }, { $set: {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    tokenExpiresAt: new Date(Date.now() + Number(data.expires_in ?? 604800) * 1000),
    lastUpdated: new Date(), status: "ACTIVE",
  } });
  return data.access_token;
}

async function isGuildMember(guildId, userId, botToken) {
  const response = await discordRequest(API + "/guilds/" + guildId + "/members/" + userId, { headers: botHeaders(botToken) });
  if (response.status === 200) return true;
  if (response.status === 404) return false;
  if (response.status === 429) throw new WorkerStop("discord_429", "대상 멤버 확인 중 Discord 요청 제한이 지속되어 복구를 중단했습니다.");
  if (response.status === 401) throw new WorkerStop("host_auth_failed", "호기 봇 토큰 인증에 실패했습니다.");
  throw new WorkerStop("member_check_failed", "Discord에서 대상 유저의 서버 가입 상태를 확인하지 못했습니다. HTTP " + response.status);
}

async function addUser(host, user, guildId, botToken, client) {
  let accessToken = storedPlaintext(user.accessToken);
  const url = API + "/guilds/" + guildId + "/members/" + user.discordUserId;
  const headers = { ...botHeaders(botToken), "Content-Type": "application/json" };
  const addMember = (token) => discordRequest(url, { method: "PUT", headers, body: JSON.stringify({ access_token: token }) });
  let response = await addMember(accessToken);
  if (response.status === 401) {
    accessToken = await refreshUserToken(host, user);
    if (!accessToken) return { kind: "failed", reason: "oauth_revoked" };
    response = await addMember(accessToken);
  }
  if (response.status === 201 || response.status === 200) return { kind: "succeeded" };
  if (response.status === 204) {
    await pause(500);
    if (await isGuildMember(guildId, user.discordUserId, botToken)) return { kind: "alreadyMember" };

    response = await addMember(accessToken);
    if (response.status === 201 || response.status === 200) return { kind: "succeeded" };
    if (response.status === 204) {
      await pause(500);
      if (await isGuildMember(guildId, user.discordUserId, botToken)) return { kind: "alreadyMember" };
      return { kind: "failed", reason: "membership_mismatch" };
    }
  }
  if (response.status === 429) throw new WorkerStop("discord_429", "Discord 요청 제한이 재시도 후에도 지속되어 복구를 중단했습니다.");
  if (!client.isReady()) throw new WorkerStop("host_offline", "호기 봇이 오프라인이 되어 복구를 중단했습니다.");
  if (response.status === 403 || response.status === 404) await assertGuildReady(guildId, botToken, client);
  return { kind: "failed", reason: response.status === 401 ? "oauth_revoked" : "discord_" + response.status };
}

async function stopRun(run, task, message, reason) {
  const completedAt = new Date();
  await RecoveryHostTask.updateOne({ _id: task._id, status: "RUNNING" }, {
    $set: { status: "FAILED", failureReason: message, completedAt, heartbeatAt: completedAt },
  });
  await RecoveryHostTask.updateMany({ runId: run._id, status: { $in: ["WAITING", "QUEUED"] } }, {
    $set: { status: "CANCELLED", failureReason: message, completedAt },
  });
  await RecoveryRun.updateOne({ _id: run._id, status: "RUNNING" }, {
    $set: { status: "FAILED", message, completedAt, estimatedRemainingSeconds: 0 },
    $inc: { ["failureReasons." + reason]: 1 },
  });
  const finalRun = await RecoveryRun.findById(run._id).lean();
  if (run.licenseId) await License.updateOne({ _id: run.licenseId, status: "IN_PROGRESS" }, { $set: {
    status: "FAILED", completedAt, activeRequestId: null,
    recoverySucceeded: Array.isArray(finalRun?.completedUserIds) ? finalRun.completedUserIds.length : Number(finalRun?.succeeded ?? 0) + Number(finalRun?.alreadyMember ?? 0),
    recoveryTotal: Number(finalRun?.overallTotal ?? finalRun?.total ?? 0), failureReason: message,
  } });
}

async function executeTask(task, client, host, botToken) {
  const run = await RecoveryRun.findOne({ _id: task.runId, status: "RUNNING" });
  if (!run) {
    await RecoveryHostTask.updateOne({ _id: task._id }, { $set: { status: "CANCELLED", completedAt: new Date() } });
    return;
  }
  const startedAt = new Date();
  await Promise.all([
    RecoveryHostTask.updateOne({ _id: task._id }, { $set: { startedAt, heartbeatAt: startedAt } }),
    RecoveryRun.updateOne({ _id: run._id }, { $set: { currentHostId: host._id, currentHostName: host.name } }),
    BotHost.updateOne({ _id: host._id }, { $max: { lastRecoveryAt: startedAt } }),
  ]);
  try {
    await assertGuildReady(run.targetGuildId, botToken, client);
    const userFilter = { hostId: host._id, status: "ACTIVE" };
    if (Array.isArray(run.targetUserIds)) userFilter._id = { $in: run.targetUserIds };
    const users = await RestoredUser.find(userFilter).sort({ createdAt: 1 }).lean();
    const startedMs = Date.now();
    for (let index = 0; index < users.length; index += 1) {
      if (!client.isReady()) throw new WorkerStop("host_offline", "호기 봇이 오프라인이 되어 복구를 중단했습니다.");
      const outcome = await addUser(host, users[index], run.targetGuildId, botToken, client);
      const remaining = Math.max(0, users.length - index - 1);
      await Promise.all([
        RecoveryHostTask.updateOne({ _id: task._id }, {
          $inc: { processed: 1, [outcome.kind]: 1 }, $set: { heartbeatAt: new Date() },
        }),
        RecoveryRun.updateOne({ _id: run._id }, {
          $inc: {
            processed: 1,
            [outcome.kind]: 1,
            ...(outcome.kind === "failed" ? { ["failureReasons." + outcome.reason]: 1 } : {}),
          },
          $set: {
            currentHostId: host._id, currentHostName: host.name,
            estimatedRemainingSeconds: Math.ceil(remaining * (Number(run.delayMs ?? 2000) + (Date.now() - startedMs) / (index + 1)) / 1000),
          },
          ...(outcome.kind === "succeeded" || outcome.kind === "alreadyMember" ? { $addToSet: { completedUserIds: users[index]._id } } : {}),
        }),
      ]);
      if (index + 1 < users.length) await pause(Math.max(1000, Number(run.delayMs ?? 2000)));
    }
    const completedAt = new Date();
    await RecoveryHostTask.updateOne({ _id: task._id, status: "RUNNING" }, { $set: { status: "COMPLETED", completedAt, heartbeatAt: completedAt } });
    const next = await RecoveryHostTask.findOneAndUpdate(
      { runId: run._id, sequence: task.sequence + 1, status: "WAITING" },
      { $set: { status: "QUEUED" } }, { returnDocument: "after" },
    );
    if (next) await RecoveryRun.updateOne({ _id: run._id, status: "RUNNING" }, { $set: { currentHostId: next.hostId } });
  } catch (error) {
    const code = error instanceof WorkerStop ? error.code : error instanceof TypeError ? "network_error" : "unexpected_error";
    const message = error instanceof WorkerStop
      ? error.message
      : error instanceof TypeError
        ? "Discord 연결 오류로 호기 복구를 중단했습니다."
        : "호기 복구 작업 중 오류가 발생했습니다.";
    await stopRun(run, task, message, code);
    console.error("Host recovery task failed:", code);
  }
}

export function startHostRecoveryWorker(client, host, botToken) {
  let stopped = false;
  let timer;
  async function poll() {
    if (stopped || working || !client.isReady()) return;
    working = true;
    try {
      const task = await RecoveryHostTask.findOneAndUpdate(
        { hostId: config.hostId, status: "QUEUED" },
        { $set: { status: "RUNNING", startedAt: new Date(), heartbeatAt: new Date() } },
        { sort: { createdAt: 1, sequence: 1 }, returnDocument: "after" },
      );
      if (task) await executeTask(task, client, host, botToken);
    } catch (error) {
      console.error("Host recovery queue poll failed:", error?.name ?? "UnknownError");
    } finally {
      working = false;
    }
  }
  timer = setInterval(() => { void poll(); }, 2000);
  timer.unref?.();
  void poll();
  return () => { stopped = true; clearInterval(timer); };
}

