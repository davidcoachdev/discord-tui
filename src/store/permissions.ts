import type { AppState } from "./types";

const ADMINISTRATOR = 1n << 3n;
const VIEW_CHANNEL = 1n << 10n;

function overwriteApply(base: bigint, allow: string, deny: string): bigint {
  let value = base;
  value &= ~BigInt(deny);
  value |= BigInt(allow);
  return value;
}

export function canViewChannel(state: AppState, guildId: string, channelId: string): boolean {
  const channel = state.channels[channelId];
  if (!channel) return false;

  // DMs y grupos: no hay permisos de guild.
  if (channel.guildId === null) return true;

  const guild = state.guilds[guildId];
  if (!guild) return false;
  if (state.me !== null && guild.ownerId === state.me.id) return true;

  const member = state.me !== null ? state.members[guildId]?.[state.me.id] : undefined;
  let permissions = 0n;

  const everyone = guild.roles.find((role) => role.id === guild.id);
  if (everyone) permissions = BigInt(everyone.permissions);
  for (const roleId of member?.roles ?? []) {
    const role = guild.roles.find((candidate) => candidate.id === roleId);
    if (role) permissions |= BigInt(role.permissions);
  }
  if ((permissions & ADMINISTRATOR) !== 0n) return true;

  const overwrites = channel.permissionOverwrites;
  const everyoneOverwrite = overwrites.find((overwrite) => overwrite.id === guild.id);
  if (everyoneOverwrite) permissions = overwriteApply(permissions, everyoneOverwrite.allow, everyoneOverwrite.deny);

  let roleAllow = 0n;
  let roleDeny = 0n;
  for (const overwrite of overwrites) {
    if (overwrite.type === 0 && member?.roles.includes(overwrite.id)) {
      roleAllow |= BigInt(overwrite.allow);
      roleDeny |= BigInt(overwrite.deny);
    }
  }
  permissions = overwriteApply(permissions, roleAllow.toString(), roleDeny.toString());

  const memberOverwrite = state.me !== null ? overwrites.find((overwrite) => overwrite.id === state.me!.id && overwrite.type === 1) : undefined;
  if (memberOverwrite) permissions = overwriteApply(permissions, memberOverwrite.allow, memberOverwrite.deny);

  return (permissions & VIEW_CHANNEL) !== 0n;
}
