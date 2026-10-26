import type { User } from '../../shared/types';
import { colorFor, initial } from '../lib/format';
import { Icon } from './Icons';

export function Avatar(props: {
  user?: Partial<User> | null; size?: number; square?: boolean; class?: string; title?: string;
  status?: boolean; onClick?: (e: MouseEvent) => void; showBorder?: boolean;
}) {
  const size = props.size ?? 40;
  const u = props.user;
  const name = u?.displayName ?? u?.username ?? 'Slop';
  const color = colorFor(u?.id ?? name, name);
  const style = { width: `${size}px`, height: `${size}px`, fontSize: `${Math.max(11, Math.round(size * 0.36))}px`, ...(u?.avatar ? {} : { background: `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 55%, var(--bg-void)))` }) };
  return (
    <div class={`avatar-wrap ${props.class ?? ''}`} onClick={props.onClick} title={props.title ?? name}>
      <div class={`avatar ${props.square ? 'sq' : ''}`} style={style}>
        {u?.avatar ? <img src={u.avatar} alt="" loading="lazy" /> : <span>{initial(name)}</span>}
      </div>
      {props.status !== false && u ? <span class={`status-dot ${u.status ?? 'offline'}`} title={u.status ?? 'offline'} /> : null}
    </div>
  );
}

export function AvatarStack({ users, size = 24, max = 4 }: { users: Partial<User>[]; size?: number; max?: number }) {
  return (
    <div class="row" style={{ gap: 0 }}>
      {users.slice(0, max).map((u, i) => (
        <div key={u.id ?? i} style={{ marginLeft: i === 0 ? 0 : `-${size * 0.3}px`, border: '2px solid var(--bg-sidebar)', borderRadius: '50%', display: 'inline-flex' }}>
          <Avatar user={u} size={size} status={false} />
        </div>
      ))}
      {users.length > max ? <span class="badge" style={{ marginLeft: 4 }}>+{users.length - max}</span> : null}
    </div>
  );
}

export function ServerIcon({ server, size = 48 }: { server: { name: string; icon: string | null }; size?: number }) {
  return (
    <div class="rail-item" style={{ width: size, height: size, pointerEvents: 'none' }}>
      {server.icon ? <img src={server.icon} alt="" /> : <span>{initial(server.name)}</span>}
    </div>
  );
}

export function EmojiImg({ emoji, size = 20, class: cls }: { emoji: string; size?: number; class?: string }) {
  if (emoji.startsWith('http') || emoji.startsWith('/')) return <img src={emoji} alt="emoji" class={`emoji-inline ${cls ?? ''}`} style={{ width: size, height: size }} loading="lazy" />;
  return <span class={cls}>{emoji}</span>;
}

export function BotTag() { return <span class="bot-tag" title="Beep boop">BOT</span>; }
export function LoadingBlock({ label = 'Loading slop…' }: { label?: string }) {
  return <div class="empty"><div class="spinner" /><p>{label}</p></div>;
}
export function EmptyState({ emoji = '🫠', title, children, action }: { emoji?: string; title: string; children?: any; action?: any }) {
  return <div class="empty"><div class="empty-emoji">{emoji}</div><h3>{title}</h3>{children ? <p>{children}</p> : null}{action}</div>;
}
export function IconText({ icon, children }: { icon: string; children: any }) {
  return <span class="row gap-8"><Icon name={icon} size={14} />{children}</span>;
}
