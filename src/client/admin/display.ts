const LABELS: Record<string, string> = {
  'admin.user.update': 'User updated',
  'admin.user.reset_password': 'Password reset',
  'admin.user.revoke_sessions': 'Sessions revoked',
  'admin.user.delete': 'User deleted',
  'admin.server.update': 'Server updated',
  'admin.server.delete': 'Server deleted',
  'admin.channel.update': 'Channel updated',
  'admin.channel.delete': 'Channel deleted',
  'admin.report.resolve': 'Report resolved',
  'admin.invite.delete': 'Server invite revoked',
  'admin.account_invite.create': 'Account invite created',
  'admin.account_invite.delete': 'Account invite revoked',
  'admin.settings.update': 'Instance settings updated',
  'admin.emoji.create': 'Emoji uploaded',
  'admin.asset.delete': 'Asset deleted',
  'admin.backup.download': 'Backup downloaded',
  'admin.maintenance.vacuum': 'Database vacuumed',
  'admin.maintenance.checkpoint': 'WAL checkpointed',
  'admin.maintenance.prune_login_attempts': 'Login attempts pruned',
  'admin.maintenance.cleanup_orphan_uploads': 'Orphan uploads cleaned',
  'admin.announce': 'Instance announcement sent',
  'user.update': 'Profile updated',
  'user.login': 'Signed in',
  'user.logout': 'Signed out',
  'message.delete': 'Message deleted',
  'message.update': 'Message edited',
  'member.ban': 'Member banned',
  'member.unban': 'Member unbanned',
  'member.kick': 'Member kicked',
  'member.timeout': 'Member timed out',
  'member.update': 'Member updated',
  'server.create': 'Server created',
  'server.update': 'Server updated',
  'server.delete': 'Server deleted',
  'channel.create': 'Channel created',
  'channel.update': 'Channel updated',
  'channel.delete': 'Channel deleted',
  'role.create': 'Role created',
  'role.update': 'Role updated',
  'role.delete': 'Role deleted',
  'invite.create': 'Invite created',
  'invite.delete': 'Invite revoked',
  'report.create': 'Report filed',
  'upload.delete': 'Upload deleted',
};

export function actionLabel(action: string): string {
  const direct = LABELS[action];
  if (direct) return direct;
  const cleaned = action.replace(/^admin\./, '').replace(/[._]/g, ' ').trim();
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : 'Unknown action';
}

export function actionTone(action: string): 'danger' | 'warning' | 'ok' | '' {
  if (/\.delete$|\.ban$|\.reset_password$|revoke/.test(action)) return 'danger';
  if (/resolve|announce|maintenance|backup/.test(action)) return 'warning';
  if (/create$/.test(action)) return 'ok';
  return '';
}

export function changeSummary(changes: Record<string, unknown> | null): string {
  if (!changes) return '';
  const entries = Object.entries(changes).filter(([, v]) => v !== null && v !== undefined);
  if (!entries.length) return '';
  return entries.slice(0, 4).map(([key, value]) => {
    const shown = typeof value === 'string' ? value : JSON.stringify(value);
    return `${key}: ${shown && shown.length > 40 ? shown.slice(0, 40) + '…' : shown}`;
  }).join(' · ') + (entries.length > 4 ? ` · +${entries.length - 4} more` : '');
}
