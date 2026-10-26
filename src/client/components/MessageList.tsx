import type { Channel, Message } from '../../shared/types';
import { MessageRow } from './Message';
import { Icon } from './Icons';
import { dayLabel, sameDay } from '../lib/format';
import { useApp } from '../lib/use-store';

export function MessageList({ channel, messages, loading, error, hasMore, loaded, onLoadMore, lastReadId, onReply, onEdit, onReport }: {
  channel: Channel; messages: Message[]; loading: boolean; error: string | null; hasMore: boolean; loaded: boolean;
  onLoadMore: () => void; lastReadId?: string | null; onReply: (m: Message) => void; onEdit: (m: Message) => void; onReport: (m: Message) => void;
}) {
  const state = useApp();
  if (!loaded && loading) {
    return <div class="message-list">
      <ChannelIntro channel={channel} />
      {[...Array(7)].map((_, i) => <div class="message group-start" key={i} style={{ opacity: .5 - i * .05 }}>
        <div class="msg-avatar-col"><div class="skeleton" style={{ width: 40, height: 40, borderRadius: '50%' }} /></div>
        <div class="msg-body"><div class="skeleton" style={{ width: 110, height: 12, marginBottom: 8 }} /><div class="skeleton" style={{ width: `${40 + i * 7}%`, height: 12, marginBottom: 5 }} /><div class="skeleton" style={{ width: `${25 + i * 5}%`, height: 12 }} /></div>
      </div>)}
    </div>;
  }
  return <div class="message-list">
    <ChannelIntro channel={channel} />
    {hasMore ? <div class="load-more">{loading ? <span class="spinner" /> : <button class="btn btn-ghost btn-sm" onClick={onLoadMore}>↑ Load older slop</button>}</div> : null}
    {error ? <div class="empty"><div class="empty-emoji">💥</div><p>{error}</p><button class="btn btn-sm" onClick={onLoadMore}>Retry</button></div> : null}
    {!messages.length && loaded ? <div class="empty" style={{ paddingBottom: 10 }}><div class="empty-emoji">🦗</div><p>No messages yet. Be the first to say something regrettable.</p></div> : null}
    {messages.map((m, i) => {
      const prev = messages[i - 1];
      const newDay = !prev || !sameDay(prev.createdAt, m.createdAt);
      const grouped = !!prev && !newDay && prev.author.id === m.author.id && m.createdAt - prev.createdAt < 5 * 60_000 && !m.replyTo && !prev.system && !m.system;
      const unreadDivider = lastReadId && prev?.id === lastReadId && m.id !== lastReadId;
      return <div key={m.id}>
        {newDay ? <DayDivider ts={m.createdAt} /> : null}
        {unreadDivider ? <div class="new-messages-divider">New messages</div> : null}
        <MessageRow message={m} channel={channel} grouped={grouped} onReply={onReply} onEdit={onEdit} onReport={onReport} />
      </div>;
    })}
  </div>;
}

function DayDivider({ ts }: { ts: number }) {
  return <div class="message-divider">{dayLabel(ts)}</div>;
}

export function ChannelIntro({ channel }: { channel: Channel }) {
  const isDm = channel.type === 'dm' || channel.type === 'group_dm';
  const icon = channel.type === 'voice' ? 'volume' : channel.type === 'forum' ? 'forum' : channel.type === 'announcement' ? 'announcement' : channel.type === 'thread' ? 'thread' : isDm ? 'user' : 'hash';
  return <div class="channel-intro">
    <div class="intro-icon"><Icon name={icon} size={30} /></div>
    <h2>{isDm ? '' : channel.type === 'thread' ? '' : '#'}{channel.name}</h2>
    <p>{channel.topic || (isDm ? 'This is the beginning of your questionable private conversation.' : `This is the beginning of the #${channel.name} channel. The slop starts here.`)}</p>
    <div class="intro-divider" />
  </div>;
}
