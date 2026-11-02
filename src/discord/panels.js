import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
} from "discord.js";

export function buildAuthPanel(hostName, authUrl) {
  return new ContainerBuilder().setAccentColor(0x77797e)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      "# " + hostName + " 유저 인증",
      "복구 대상 계정과 Discord 서버 멤버 추가 권한을 연결하려면 아래 버튼을 눌러 인증해 주세요.",
      "인증은 Discord OAuth 화면에서 직접 동의한 경우에만 완료됩니다.",
    ].join("\n")))
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel("Discord 인증하기").setStyle(ButtonStyle.Link).setURL(authUrl),
    ));
}

export function buildResultCard(title, lines, accent = 0x77797e) {
  return new ContainerBuilder().setAccentColor(accent)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent("# " + title + "\n" + lines.join("\n")));
}
