import type { ComponentChildren, VNode } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../components/Icons';
import { useApp, store } from './use-store';
import { fmtDate, fmtDateTime, fmtRelative, fmtTime, isEmojiOnly } from './format';
import type { Emoji, User } from '../../shared/types';

interface InlineCtx {
  users: Map<string, User>;
  channels: Map<string, { id: string; name: string }>;
  roles: Map<string, { id: string; name: string; color: string }>;
  emojis: Map<string, Emoji>;
  keyBase: string;
}

function renderTimestamp(epoch: number, style: string | undefined): string {
  const ms = epoch * 1000;
  switch (style) {
    case 't': return fmtTime(ms);
    case 'T': return new Date(ms).toLocaleTimeString();
    case 'd': return fmtDate(ms);
    case 'D': return new Date(ms).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
    case 'R': return fmtRelative(ms);
    default: return fmtDateTime(ms);
  }
}

function spoilerNode(content: ComponentChildren, key: string) {
  return <Spoiler key={key}>{content}</Spoiler>;
}

function Spoiler({ children }: { children: ComponentChildren }) {
  const [revealed, setRevealed] = useState(false);
  return <span class={`md-spoiler ${revealed ? 'revealed' : ''}`} onClick={() => setRevealed(true)} title={revealed ? undefined : 'Spoiler — click to reveal'}>{children}</span>;
}

const INLINE_PATTERNS: { type: string; re: RegExp }[] = [
  { type: 'code', re: /`([^`\n]+)`/ },
  { type: 'image', re: /!\[([^\]]*)\]\(([^)\s]+)\)/ },
  { type: 'customEmoji', re: /<(a?):([A-Za-z0-9_~]+):([A-Za-z0-9_-]+)>/ },
  { type: 'user', re: /<@[!&]?([A-Za-z0-9_-]+)>/ },
  { type: 'channel', re: /<#([A-Za-z0-9_-]+)>/ },
  { type: 'link', re: /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/ },
  { type: 'spoiler', re: /\|\|([\s\S]+?)\|\|/ },
  { type: 'bold', re: /\*\*([\s\S]+?)\*\*/ },
  { type: 'underline', re: /__([\s\S]+?)__/ },
  { type: 'strike', re: /~~([\s\S]+?)~~/ },
  { type: 'italic', re: /(?<![\w*])\*([^*\n]+)\*(?!\*)/ },
  { type: 'italic', re: /(?<![\w_])_([^_\n]+)_(?!_)/ },
  { type: 'everyone', re: /(?<!\w)@(everyone|here)\b/ },
  { type: 'timestamp', re: /<t:(\d+)(?::([tTdDfFR]))?>/ },
  { type: 'url', re: /(https?:\/\/[^\s<)]+)/ },
];

export function renderInline(text: string, ctx: InlineCtx): ComponentChildren[] {
  const out: ComponentChildren[] = [];
  let rest = text;
  let guard = 0;
  while (rest && guard++ < 500) {
    let earliest: { type: string; match: RegExpExecArray } | null = null;
    for (const p of INLINE_PATTERNS) {
      const re = new RegExp(p.re.source, p.re.flags.replace('g', '') + 'g');
      const m = re.exec(rest);
      if (m && (!earliest || m.index < earliest.match.index)) earliest = { type: p.type, match: m };
    }
    if (!earliest) { out.push(rest); break; }
    const { type, match: m } = earliest;
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const key = `${ctx.keyBase}-${guard}`;
    switch (type) {
      case 'code':
        out.push(<code key={key} class="md-code-inline">{m[1]}</code>); break;
      case 'image': {
        const [, alt, url] = m;
        if (url && (url.startsWith('/static/') || url.startsWith('/api/media/') || url.startsWith('/api/attachments/'))) {
          out.push(<img key={key} class="md-image" src={url} alt={alt || 'slop meme'} loading="lazy" onClick={() => store.openLightbox(url, alt)} />);
        } else out.push(alt ?? '');
        break;
      }
      case 'customEmoji': {
        const [, animated, name, id] = m;
        const emoji = ctx.emojis.get(id!) ?? [...ctx.emojis.values()].find((e) => e.name === name);
        if (emoji) out.push(<img key={key} src={emoji.url} alt={`:${name}:`} title={`:${name}:`} class="emoji-inline" loading="lazy" />);
        else out.push(<span key={key} class="md-code-inline">:{name}:</span>);
        break;
      }
      case 'user': {
        const id = m[1]!;
        const user = ctx.users.get(id);
        const isRole = m[0].startsWith('<@&');
        if (isRole) {
          const role = ctx.roles.get(id);
          out.push(<span key={key} class="mention-pill" style={role ? { color: role.color, background: `color-mix(in srgb, ${role.color} 20%, transparent)` } : undefined}>@{role?.name ?? 'role'}</span>);
        } else {
          out.push(<span key={key} class="mention-pill" role="button" tabindex={0} onClick={(e) => { e.stopPropagation(); void store.showProfile(id); }}>@{user?.displayName ?? 'unknown slop'}</span>);
        }
        break;
      }
      case 'channel': {
        const id = m[1]!;
        const ch = ctx.channels.get(id);
        out.push(<span key={key} class="channel-ref" role="button" tabindex={0} onClick={() => {
          if (ch && store.state.activeServerId) void store.openChannel(store.state.activeServerId, ch.id);
        }}>{ch ? `#${ch.name}` : '#unknown-channel'}</span>);
        break;
      }
      case 'link': {
        const [, label, url] = m;
        out.push(<a key={key} class="md-link" href={url} target="_blank" rel="noopener noreferrer nofollow">{label}</a>);
        break;
      }
      case 'spoiler':
        out.push(spoilerNode(renderInline(m[1]!, { ...ctx, keyBase: key }), key)); break;
      case 'bold':
        out.push(<strong key={key}>{renderInline(m[1]!, { ...ctx, keyBase: key })}</strong>); break;
      case 'underline':
        out.push(<u key={key}>{renderInline(m[1]!, { ...ctx, keyBase: key })}</u>); break;
      case 'strike':
        out.push(<s key={key}>{renderInline(m[1]!, { ...ctx, keyBase: key })}</s>); break;
      case 'italic':
        out.push(<em key={key}>{renderInline(m[1]!, { ...ctx, keyBase: key })}</em>); break;
      case 'everyone':
        out.push(<span key={key} class="mention-pill everyone">@{m[1]}</span>); break;
      case 'timestamp':
        out.push(<span key={key} class="mention-pill" title={fmtDateTime(Number(m[1]) * 1000)}>{renderTimestamp(Number(m[1]), m[2])}</span>); break;
      case 'url': {
        const raw = m[1]!;
        let safe = raw;
        if (!/^https?:\/\//i.test(safe)) safe = '';
        if (safe) out.push(<a key={key} class="md-link" href={safe} target="_blank" rel="noopener noreferrer nofollow">{raw}</a>);
        else out.push(raw);
        break;
      }
    }
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };
  return <div class="md-codeblock">
    <div class="code-head"><span>{lang || 'slop'}</span><button class="btn-link" onClick={copy}>{copied ? <span class="row gap-4"><Icon name="check" size={12} />copied</span> : <span class="row gap-4"><Icon name="copy" size={12} />copy</span>}</button></div>
    <pre><code>{code}</code></pre>
  </div>;
}

export function Markdown({ content, class: className }: { content: string; class?: string }) {
  const state = useApp();
  const users = new Map<string, User>();
  if (state.user) users.set(state.user.id, state.user);
  for (const b of Object.values(state.servers)) for (const m of b.members) users.set(m.user.id, m.user);
  for (const d of state.dms) for (const m of d.members) users.set(m.id, m);
  for (const f of [...state.friends.friends, ...state.friends.incoming, ...state.friends.outgoing]) users.set(f.user.id, f.user);
  if (state.ui.profile) users.set(state.ui.profile.id, state.ui.profile);
  const channels = new Map<string, { id: string; name: string }>();
  for (const b of Object.values(state.servers)) for (const ch of b.channels) channels.set(ch.id, { id: ch.id, name: ch.name });
  const roles = new Map<string, { id: string; name: string; color: string }>();
  for (const b of Object.values(state.servers)) for (const r of b.roles) roles.set(r.id, { id: r.id, name: r.name, color: r.color });
  const emojis = new Map<string, Emoji>();
  for (const b of Object.values(state.servers)) for (const e of b.emojis) emojis.set(e.id, e);
  const ctx: InlineCtx = { users, channels, roles, emojis, keyBase: 'md' };

  if (isEmojiOnly(content)) return <div class={`msg-content jumbo ${className ?? ''}`}><JumboEmoji content={content} ctx={ctx} /></div>;

  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: ComponentChildren[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim().split(/\s+/)[0] ?? '';
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith('```')) { code.push(lines[i]!); i++; }
      if (i < lines.length) i++;
      blocks.push(<CodeBlock key={`cb${key++}`} code={code.join('\n')} lang={lang} />);
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!)) { quote.push(lines[i]!.replace(/^>\s?/, '')); i++; }
      blocks.push(<blockquote key={`q${key++}`} class="md-quote">{renderInline(quote.join('\n'), ctx)}</blockquote>);
      continue;
    }
    if (/^#{1,3}\s/.test(line)) {
      const level = line.match(/^#+/)?.[0].length ?? 1;
      const text = line.replace(/^#+\s/, '');
      const Tag = `h${Math.min(level + 1, 4)}` as any;
      blocks.push(<Tag key={`h${key++}`} class="md-heading">{renderInline(text, ctx)}</Tag>);
      i++; continue;
    }
    if (/^\s*[-*]\s/.test(line) || /^\s*\d+\.\s/.test(line)) {
      const ordered = /^\s*\d+\.\s/.test(line);
      const items: string[] = [];
      while (i < lines.length && (/^\s*[-*]\s/.test(lines[i]!) || /^\s*\d+\.\s/.test(lines[i]!))) {
        items.push(lines[i]!.replace(/^\s*(?:[-*]|\d+\.)\s/, '')); i++;
      }
      const L = ordered ? 'ol' : 'ul';
      blocks.push(<L key={`l${key++}`} class="md-list">{items.map((it, j) => <li key={j}>{renderInline(it, ctx)}</li>)}</L>);
      continue;
    }
    if (/^---+$/.test(line.trim())) { blocks.push(<hr key={`hr${key++}`} />); i++; continue; }
    if (line.trim() === '') { i++; continue; }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== '' && !lines[i]!.startsWith('```') && !/^>\s?/.test(lines[i]!) && !/^#{1,3}\s/.test(lines[i]!) && !/^\s*[-*]\s/.test(lines[i]!)) {
      para.push(lines[i]!); i++;
    }
    blocks.push(<div key={`p${key++}`} class="md-para">{para.map((p, j) => <span key={j}>{renderInline(p, ctx)}{j < para.length - 1 ? <br /> : null}</span>)}</div>);
  }
  return <div class={`msg-content ${className ?? ''}`}>{blocks}</div>;
}

function JumboEmoji({ content, ctx }: { content: string; ctx: InlineCtx }) {
  const nodes = renderInline(content, ctx);
  return <>{nodes}</>;
}

export function PlainText({ text }: { text: string }) { return <>{text}</>; }
