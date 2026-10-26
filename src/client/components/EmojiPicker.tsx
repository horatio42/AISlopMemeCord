import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { useApp } from '../lib/use-store';
import { Icon } from './Icons';

const UNICODE: Record<string, string[]> = {
  'Smileys': ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','🥰','😍','🤩','😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤗','🤭','🫢','🤫','🤔','🫡','🤐','🤨','😐','😑','😶','🫥','😏','😒','🙄','😬','😮‍💨','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸','😎','🤓','🧐','😕','😟','🙁','😮','😯','😲','😳','🥺','🥹','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','💩','🤡','👹','👺','👻','👽','👾','🤖'],
  'Gestures': ['👍','👎','👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','🫵','👋','🤚','🖐️','✋','🖖','🫱','🫲','🫳','🫴','👏','🙌','🫶','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦵','🦶','👂','👃','🧠','🫀','🫁','🦷','🦴','👀','👁️','👅','👄'],
  'Hearts': ['❤️','🩷','🧡','💛','💚','💙','🩵','💜','🖤','🩶','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','💌','🫶','😻'],
  'Animals': ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐻‍❄️','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐒','🐔','🐧','🐦','🐤','🐣','🐥','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🪱','🐛','🦋','🐌','🐞','🐜','🪰','🪲','🪳','🦟','🦗','🕷️','🕸️','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐅','🐆','🦓','🦍','🦧','🐘','🦛','🦏','🐪','🐫','🦒','🦘','🐃','🐂','🐄','🐎','🐖','🐏','🐑','🦙','🐐','🦌','🐕','🐩','🦮','🐕‍🦺','🐈','🪶','🐓','🦃','🦤','🦚','🦜','🦢','🦩','🕊️','🐇','🦝','🦨','🦡','🦫','🦦','🦥','🐁','🐀','🐿️','🦔'],
  'Food': ['🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🫑','🌽','🥕','🫒','🧄','🧅','🥔','🍠','🥐','🥯','🍞','🥖','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🌭','🍔','🍟','🍕','🫓','🥪','🥙','🧆','🌮','🌯','🫔','🥗','🥘','🫕','🥫','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🦪','🍤','🍙','🍚','🍘','🍥','🥠','🥮','🍢','🍡','🍧','🍨','🍦','🥧','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜','🍯','🥛','🍼','🫖','🍵','🧃','🥤','🧋','🍶','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🧉','🍾'],
  'Activities': ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🏒','🏑','🥍','🏏','🪃','🥅','⛳','🪁','🏹','🎣','🤿','🥊','🥋','🎽','🛹','🛼','🛷','⛸️','🥌','🎿','⛷️','🏂','🪂','🏋️','🤼','🤸','⛹️','🤺','🤾','🏌️','🏇','🧘','🏄','🏊','🤽','🚣','🧗','🚵','🚴','🏆','🥇','🥈','🥉','🏅','🎖️','🏵️','🎗️','🎫','🎟️','🎪','🤹','🎭','🩰','🎨','🎬','🎤','🎧','🎼','🎹','🥁','🪘','🎷','🎺','🪗','🎸','🪕','🎻','🎲','♟️','🎯','🎳','🎮','🎰','🧩'],
  'Objects': ['⌚','📱','💻','⌨️','🖥️','🖨️','🖱️','🖲️','🕹️','🗜️','💽','💾','💿','📀','📼','📷','📸','📹','🎥','📽️','🎞️','📞','☎️','📟','📠','📺','📻','🎙️','🎚️','🎛️','🧭','⏱️','⏲️','⏰','🕰️','⌛','⏳','📡','🔋','🪫','🔌','💡','🔦','🕯️','🪔','🧯','🛢️','💸','💵','💴','💶','💷','🪙','💰','💳','🧾','💎','⚖️','🪜','🧰','🪛','🔧','🔩','⚙️','🗜️','⚗️','🧪','🧫','🧬','🦠','💉','🩸','💊','🩹','🩼','🩺','🚪','🛗','🪞','🪟','🛏️','🛋️','🪑','🚽','🪠','🚿','🛁','🪤','🪒','🧴','🧷','🧹','🧺','🧻','🪣','🧼','🫧','🪥','🧽','🧯','🛒','🚬','⚰️','🪦','⚱️','🏺','🔮','📿','🧿','🪬','💈','⚗️','🔭','🔬','🕳️','🩻','🩹','🩺'],
  'Symbols': ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉️','☸️','✡️','🔯','🕎','☯️','☦️','🛐','⛎','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','🆔','⚛️','🉑','☢️','☣️','📴','📳','🈶','🈚','🈸','🈺','🈷️','✴️','🆚','💮','🉐','㊙️','㊗️','🈴','🈵','🈹','🈲','🅰️','🅱️','🆎','🆑','🅾️','🆘','❌','⭕','🛑','⛔','📛','🚫','💯','💢','♨️','🚷','🚯','🚳','🚱','🔞','📵','🚭','❗','❕','❓','❔','‼️','⁉️','🔅','🔆','〽️','⚠️','🚸','🔱','⚜️','🔰','♻️','✅','🈯','💹','❇️','✳️','❎','🌐','💠','Ⓜ️','🌀','💤','🏧','🚾','♿','🅿️','🛗','🈳','🈂️','🛂','🛃','🛄','🛅','🚹','🚺','🚼','🚻','🚮','🎦','📶','🈁','🔣','ℹ️','🔤','🔡','🔠','🆖','🆗','🆙','🆒','🆕','🆓','0️⃣','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟','🔢','#️⃣','*️⃣','⏏️','▶️','⏸️','⏯️','⏹️','⏺️','⏭️','⏮️','⏩','⏪','⏫','⏬','◀️','🔼','🔽','➡️','⬅️','⬆️','⬇️','↗️','↘️','↙️','↖️','↕️','↔️','↩️','↪️','⤴️','⤵️','🔀','🔁','🔂','🔄','🔃','🎵','🎶','➕','➖','➗','✖️','🟰','♾️','💲','💱','™️','©️','®️','👁️‍🗨️','🔚','🔙','🔛','🔝','🔜','〰️','➰','➿','✔️','☑️','🔘','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤','🔺','🔻','🔸','🔹','🔶','🔷','🔳','🔲','▪️','▫️','◾','◽','◼️','◻️','🟥','🟧','🟨','🟩','🟦','🟪','⬛','⬜','🟫','🔈','🔇','🔉','🔊','🔔','🔕','📣','📢','💬','💭','🗯️','♠️','♣️','♥️','♦️','🃏','🎴','🀄','🕐','🕑','🕒','🕓','🕔','🕕','🕖','🕗','🕘','🕙','🕚','🕛'],
};

export function EmojiPicker(props: { onPick: (emoji: string) => void; onClose: () => void; anchor?: { x: number; y: number }; stickers?: boolean; onSticker?: (sticker: any) => void }) {
  const state = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState('Smileys');
  const [query, setQuery] = useState('');
  const categories = Object.keys(UNICODE);
  const custom = useMemo(() => Object.values(state.servers).flatMap((b) => b.emojis), [state.servers]);
  const stickers = useMemo(() => Object.values(state.servers).flatMap((b) => b.stickers), [state.servers]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) props.onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose(); };
    setTimeout(() => document.addEventListener('pointerdown', close), 0);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', key); };
  }, [props]);
  const anchor = props.anchor ?? { x: window.innerWidth - 380, y: window.innerHeight - 460 };
  const left = Math.max(8, Math.min(anchor.x, window.innerWidth - 350));
  const top = Math.max(8, Math.min(anchor.y, window.innerHeight - 430));
  const filteredUnicode = query ? categories.flatMap((c) => UNICODE[c]!).filter((e) => e.includes(query)) : UNICODE[tab] ?? [];
  return createPortal(
    <div ref={ref} class="emoji-picker" style={{ position: 'fixed', left: `${left}px`, top: `${top}px`, zIndex: 2700 }} role="dialog" aria-label="Emoji picker">
      <div class="emoji-picker-head">
        <div class="search-input grow"><Icon name="search" size={13} /><input class="input" style={{ padding: '6px 8px 6px 30px' }} placeholder="Search emoji…" value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} autoFocus /></div>
        <button class="btn-icon sm" onClick={props.onClose}><Icon name="close" size={15} /></button>
      </div>
      <div class="emoji-tabs">
        {categories.map((c) => <button key={c} class={tab === c && !query ? 'active' : ''} title={c} onClick={() => { setTab(c); setQuery(''); }}>{c === 'Smileys' ? '😀' : c === 'Gestures' ? '👍' : c === 'Hearts' ? '❤️' : c === 'Animals' ? '🐸' : c === 'Food' ? '🍕' : c === 'Activities' ? '🎮' : c === 'Objects' ? '💾' : '💯'}</button>)}
        {custom.length ? <button class={tab === 'custom' ? 'active' : ''} title="Custom emoji" onClick={() => { setTab('custom'); setQuery(''); }}>⭐</button> : null}
        {props.stickers && stickers.length ? <button class={tab === 'stickers' ? 'active' : ''} title="Stickers" onClick={() => { setTab('stickers'); setQuery(''); }}>🖼️</button> : null}
      </div>
      <div class="emoji-scroll">
        {query ? <><div class="emoji-cat-label">Search results</div><div class="emoji-grid">{filteredUnicode.slice(0, 120).map((e) => <button key={e} class="emoji-cell" title={e} onClick={() => props.onPick(e)}>{e}</button>)}</div></> : tab === 'custom' ? <>
          <div class="emoji-cat-label">Custom emoji</div>
          <div class="emoji-grid">{custom.map((e) => <button key={e.id} class="emoji-cell" title={`:${e.name}:`} onClick={() => props.onPick(`${e.name}:${e.id}`)}><img src={e.url} alt={e.name} /></button>)}</div>
        </> : tab === 'stickers' ? <>
          <div class="emoji-cat-label">Stickers (they’re just big emojis)</div>
          <div class="sticker-grid">{stickers.map((s) => <button key={s.id} class="sticker-cell" onClick={() => props.onSticker?.(s)}><img src={s.url} alt={s.name} /><div class="faint" style={{ fontSize: 10, textAlign: 'center' }}>{s.name}</div></button>)}</div>
        </> : <>
          <div class="emoji-cat-label">{tab}</div>
          <div class="emoji-grid">{(UNICODE[tab] ?? []).map((e) => <button key={e} class="emoji-cell" title={e} onClick={() => props.onPick(e)}>{e}</button>)}</div>
        </>}
      </div>
      <div class="emoji-picker-foot">Unicode emoji are rendered by your device. Custom emoji live in /data. Privacy intact.</div>
    </div>, document.body,
  );
}
