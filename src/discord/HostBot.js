import {
  Client,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { config } from "../config.js";
import { BotHost } from "../models/BotHost.js";
import { AuthPanel } from "../models/AuthPanel.js";
import { buildAuthPanel, buildResultCard } from "./panels.js";
import { startHostRecoveryWorker } from "../services/HostRecoveryWorker.js";
import { startHostPresence } from "../services/HostPresence.js";
import { probeDiscordGatewayRest } from "./DiscordGatewayProbe.js";
import { syncGuildCommands } from "./commandSync.js";

const authPanelCommand = new SlashCommandBuilder()
  .setName("인증패널")
  .setDescription("현재 채널에 유저 인증 패널을 게시합니다.")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addRoleOption((option) => option.setName("역할").setDescription("인증 후 지급할 역할").setRequired(true));
export async function startHostBot(host, token) {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  let heartbeatTimer;
  let stopPresence;
  client.on("error", (error) => console.error("Host bot client error:", error?.message ?? error?.name ?? "UnknownError"));
  client.on("debug", (message) => {
    if (/Preparing to connect to the gateway|Fetched Gateway Information|Connecting to wss:|Waiting for identify|Sending IDENTIFY|network error/i.test(message)) {
      console.log("Host bot gateway stage:", message);
    }
  });
  client.on("shardError", (error, shardId) => console.error("Host bot gateway error:", { shardId, message: error?.message ?? error?.name ?? "UnknownError" }));
  client.on("shardDisconnect", (event, shardId) => {
    console.error("Host bot gateway disconnected:", { shardId, code: event?.code, reason: event?.reason?.toString?.() ?? "" });
    void writeHeartbeat(false).catch(() => {});
  });

  async function writeHeartbeat(online) {
    await BotHost.updateOne({ _id: config.hostId }, { $set: {
      runtimeHeartbeatAt: online ? new Date() : null,
      runtimeUsername: online ? String(client.user?.tag ?? client.user?.username ?? "") : "",
    } });
  }

  client.once("ready", async () => {
    await writeHeartbeat(true).catch((error) => console.error("Heartbeat write failed:", error?.name ?? "UnknownError"));
    stopPresence = startHostPresence(client, config.hostId);
    heartbeatTimer = setInterval(() => { void writeHeartbeat(client.isReady()).catch((error) => console.error("Heartbeat write failed:", error?.name ?? "UnknownError")); }, 15_000);
    heartbeatTimer.unref?.();
    console.log("Host bot online:", host.name, client.user?.tag ?? "");
  });
  syncGuildCommands(client, [authPanelCommand], host.name);

  client.on("shardReady", () => { void writeHeartbeat(true).catch(() => {}); });
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    try {
      if (interaction.commandName === "인증패널") {
        if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({ flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2, components: [buildResultCard("권한 없음", ["서버 관리자만 인증 패널을 게시할 수 있습니다."])] });
        }
        const role = interaction.options.getRole("역할", true);
        const panel = await AuthPanel.create({
          hostId: config.hostId,
          guildId: interaction.guildId,
          guildName: interaction.guild.name,
          roleId: role.id,
          roleName: role.name,
          channelId: interaction.channelId,
        });
        const authUrl = config.publicBaseUrl + "/oauth/start/" + config.hostId + "/" + panel.id;
        try {
          await interaction.channel.send({ flags: MessageFlags.IsComponentsV2, components: [buildAuthPanel(host.name, authUrl)] });
        } catch (error) {
          await AuthPanel.deleteOne({ _id: panel._id }).catch(() => {});
          throw error;
        }
        return interaction.reply({ flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2, components: [buildResultCard("인증 패널 게시 완료", ["현재 채널에 게시했습니다.", "인증 완료 시 " + role.toString() + " 역할을 지급합니다."])] });
      }

    } catch (error) {
      console.error("Host bot command failed:", error?.name ?? "UnknownError");
      const card = buildResultCard("요청 처리 실패", [error?.message ?? "잠시 후 다시 시도해 주세요."], 0xed4245);
      if (interaction.deferred || interaction.replied) await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [card] }).catch(() => {});
      else await interaction.reply({ flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2, components: [card] }).catch(() => {});
    }
  });

  console.log("Connecting host bot to Discord:", host.name);
  await probeDiscordGatewayRest(token, "Host bot");
  let loginTimeout;
  try {
    await Promise.race([
      client.login(token),
      new Promise((_, reject) => { loginTimeout = setTimeout(() => reject(new Error("Discord Gateway login timed out after 30 seconds.")), 30_000); }),
    ]);
    console.log("Host bot gateway connected; waiting for READY:", host.name);
  } catch (error) {
    client.destroy();
    throw error;
  } finally {
    clearTimeout(loginTimeout);
  }
  const stopRecoveryWorker = startHostRecoveryWorker(client, host, token);
  return {
    client,
    async stop() {
      clearInterval(heartbeatTimer);
      stopPresence?.();
      stopRecoveryWorker();
      await writeHeartbeat(false).catch(() => {});
      client.destroy();
    },
  };
}
