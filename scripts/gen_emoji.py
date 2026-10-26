#!/usr/bin/env python3
"""Generate original vector emoji, stickers, and avatars. Self-hosted, no third-party art."""
from pathlib import Path
from xml.sax.saxutils import escape
A = Path(__file__).resolve().parent.parent / 'src' / 'assets'
for d in ('emoji','stickers','avatars','memes','badges'): (A/d).mkdir(parents=True, exist_ok=True)

def svg(name, inner, size=64, bg='none', round_bg=True):
    b = f'<rect width="{size}" height="{size}" rx="{size*0.22 if round_bg else 0}" fill="{bg}"/>' if bg != 'none' else ''
    t = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" width="{size}" height="{size}">{b}{inner}</svg>'
    (A/'emoji'/f'{name}.svg').write_text(t + '\n')

def face(name, bg, body, eyes='auto', mouth='smile', extra='', blush=True):
    color = {'yellow':'#ffd93d','green':'#a8f22b','red':'#ff5d5d','purple':'#b58cff','blue':'#5ee7ff','pink':'#ff8fc7','gray':'#a9b0c0','orange':'#ffa64d'}[bg]
    e = eyes
    if eyes == 'auto':
        e = '<circle cx="23" cy="28" r="6" fill="#fff"/><circle cx="41" cy="28" r="6" fill="#fff"/><circle cx="24.5" cy="29" r="3" fill="#1a0e2c"/><circle cx="39.5" cy="29" r="3" fill="#1a0e2c"/>'
    elif eyes == 'x':
        e = '<path d="m17 23 11 11M28 23 17 34M36 23l11 11M47 23 36 34" stroke="#1a0e2c" stroke-width="4" stroke-linecap="round"/>'
    elif eyes == 'sus':
        e = '<rect x="16" y="23" width="13" height="7" rx="2" fill="#fff"/><rect x="35" y="23" width="13" height="7" rx="2" fill="#fff"/><rect x="20" y="24" width="5" height="4" fill="#1a0e2c"/>'
    elif eyes == 'sunglasses':
        e = '<path d="M14 22h16v10H18a4 4 0 0 1-4-4Zm20 0h16l-2 6a4 4 0 0 1-4 4H34Z" fill="#171021"/><path d="M30 24h4" stroke="#171021" stroke-width="3"/>'
    elif eyes == 'closed':
        e = '<path d="M17 28q5-7 10 0M37 28q5-7 10 0" fill="none" stroke="#1a0e2c" stroke-width="3" stroke-linecap="round"/>'
    elif eyes == 'dots':
        e = '<circle cx="24" cy="28" r="2.5" fill="#1a0e2c"/><circle cx="40" cy="28" r="2.5" fill="#1a0e2c"/>'
    elif eyes == 'teary':
        e = '<circle cx="23" cy="27" r="6" fill="#fff"/><circle cx="41" cy="27" r="6" fill="#fff"/><circle cx="24" cy="28" r="3" fill="#1a0e2c"/><circle cx="40" cy="28" r="3" fill="#1a0e2c"/><path d="M20 36c-3 7-2 10 1 10s3-4 0-9M44 36c3 7 2 10-1 10s-3-4 0-9" fill="#5ee7ff"/>'
    mouths = {
      'smile': '<path d="M22 42q10 12 20 0" fill="none" stroke="#1a0e2c" stroke-width="4" stroke-linecap="round"/>',
      'open': '<path d="M20 40q12 16 24 0Z" fill="#1a0e2c"/><path d="M27 44q5 7 10 0Z" fill="#ff5fa2"/>',
      'sad': '<path d="M23 47q9-10 18 0" fill="none" stroke="#1a0e2c" stroke-width="4" stroke-linecap="round"/>',
      'none': '',
      'wavy': '<path d="M22 44q4-5 8 0t8 0 8 0" fill="none" stroke="#1a0e2c" stroke-width="3.5" stroke-linecap="round"/>',
    }
    blushmarks = '<ellipse cx="14" cy="39" rx="5" ry="3" fill="#ff7ac8" opacity=".55"/><ellipse cx="50" cy="39" rx="5" ry="3" fill="#ff7ac8" opacity=".55"/>' if blush else ''
    svg(name, f'<circle cx="32" cy="32" r="30" fill="{color}"/><circle cx="32" cy="32" r="30" fill="none" stroke="#1a0e2c" stroke-width="2.5" opacity=".18"/>{blushmarks}{e}{mouths[mouth]}{extra}')

face('based','yellow','', eyes='auto', mouth='smile', extra='<path d="M48 12 54 6l4 8-6 4Z" fill="#ffe066"/>')
face('sus','red','', eyes='sus', mouth='none', extra='<path d="M20 39h24" stroke="#1a0e2c" stroke-width="3" stroke-linecap="round"/>', blush=False)
face('kek','yellow','', eyes='closed', mouth='open', extra='<path d="M12 26c-2 8-1 12 2 12s4-5 0-11M52 26c2 8 1 12-2 12s-4-5 0-11" fill="#5ee7ff"> <animate attributeName="opacity" values="1;0;1" dur="0.7s" repeatCount="indefinite"/></path>')
face('copium','green','', eyes='dots', mouth='open', extra='<path d="M12 38h40l-4 16H16Z" fill="#7a8b5a" opacity=".85"/><circle cx="24" cy="46" r="2" fill="#3c4a2a"/><circle cx="40" cy="46" r="2" fill="#3c4a2a"/>')
face('sob','blue','', eyes='teary', mouth='sad', blush=False)
face('vibing','orange','', eyes='sunglasses', mouth='smile')
face('clown','gray','', eyes='auto', mouth='open', extra='<path d="M12 11q20-13 40 0l-2 8q-18-8-36 0Z" fill="#ff5d5d"/><circle cx="32" cy="8" r="6" fill="#ffd93d"/><path d="M30 40h4" stroke="#1a0e2c" stroke-width="2"/>', blush=True)
face('brainlet','pink','', eyes='dots', mouth='wavy', extra='<path d="M10 18c0-8 8-10 10-4 2-7 12-7 14 0 3-6 12-4 12 4 5 2 5 9 0 10 3 7-4 12-9 8-3 6-12 6-15 0-6 4-13-1-10-8-6-2-6-10-2-10Z" fill="#ffb7d5" opacity=".8"/>', blush=False)
face('oof','purple','', eyes='x', mouth='wavy', blush=False)
face('hyperrage','red','', eyes='auto', mouth='open', extra='<path d="M9 20 16 9l6 8M55 20 48 9l-6 8" fill="none" stroke="#1a0e2c" stroke-width="3" stroke-linecap="round"/><path d="m28 20 4-6 4 6" fill="none" stroke="#1a0e2c" stroke-width="2.5"/>', blush=True)
face('nerd','yellow','', eyes='auto', mouth='smile', extra='<path d="M14 25h16v11H18a5 5 0 0 1-4-5Zm20 0h16v11H34a5 5 0 0 1 0-11Z" fill="none" stroke="#1a0e2c" stroke-width="3"/><path d="M30 30h4" stroke="#1a0e2c" stroke-width="3"/>', blush=False)
face('kneel','yellow','', eyes='closed', mouth='smile', extra='<path d="M16 18 20 4l12 8 12-8 4 14Z" fill="#ffd447" stroke="#a27300" stroke-width="2.4"/>')
face('dead','gray','', eyes='x', mouth='none', extra='<path d="M20 44h24v6a4 4 0 0 1-4 4H24a4 4 0 0 1-4-4Z" fill="#1a0e2c" opacity=".25"/>', blush=False)
face('o7','purple','', eyes='closed', mouth='none', extra='<path d="M45 38c5-5 9 3 5 10l-5 8-7-5Z" fill="#ffd7a6"/><path d="M49 18l-6 10" stroke="#1a0e2c" stroke-width="3"/>', blush=False)
# slop blob
svg('slop', '<path d="M32 4C20 4 10 13 9 26c-1 8 2 15 7 18 4 2 6-2 8-2s5 6 8 4c4-2 7-5 8-11 1-7 6-9 6-15C50 11 42 4 32 4Z" fill="#b8ff35" stroke="#4f8c14" stroke-width="2"/><circle cx="24" cy="24" r="5" fill="#fff"/><circle cx="39" cy="24" r="5" fill="#fff"/><circle cx="25" cy="25" r="2.2" fill="#1a0e2c"/><circle cx="38" cy="25" r="2.2" fill="#1a0e2c"/><path d="M25 35c5 5 11 5 15 0" fill="none" stroke="#1a0e2c" stroke-width="2.6" stroke-linecap="round"/>')
# goblin
svg('goblin', '<circle cx="32" cy="32" r="30" fill="#2a1240"/><path d="M33 8c-11 0-18 8-19 19 0 7 2 12 6 15 3 2 5-2 7-2s3 4 6 3c4-1 6-5 6-9 1-6 5-7 6-12 1-10-4-14-12-14Z" fill="#a8f22b"/><circle cx="25" cy="25" r="5" fill="#fff"/><circle cx="39" cy="25" r="5" fill="#fff"/><circle cx="26" cy="26" r="2.4" fill="#1a0e2c"/><circle cx="38" cy="26" r="2.4" fill="#1a0e2c"/><path d="M24 38c4 5 10 5 14 0" fill="none" stroke="#1a0e2c" stroke-width="3" stroke-linecap="round"/><path d="M8 12 12 4l7 5 7-6 4 9" fill="#ffd447" stroke="#a27300" stroke-width="2"/>')
# banger fire
svg('banger', '<path d="M32 4c5 12-4 15 2 22 3-6 7-6 8-1 3-8 12 3 12 14 0 12-10 20-22 20S10 51 10 39c0-11 7-16 11-24 3-6 7-9 11-11Z" fill="#ff9f1c"/><path d="M32 22c3 8-2 10 1 15 2-4 6-4 7 1 2-5 7 1 7 7 0 7-6 11-13 11s-13-5-13-12c0-6 4-10 7-15 2-4 3-6 4-7Z" fill="#ffe066"/>')
# ratio arrow + L
svg('ratio','<circle cx="32" cy="32" r="30" fill="#ff5d5d"/><path d="M14 25h22v-9l16 16-16 16v-9H14Z" fill="#fff" stroke="#1a0e2c" stroke-width="2"/><text x="32" y="56" font-family="monospace" font-size="13" font-weight="900" fill="#1a0e2c" text-anchor="middle">RATIO</text>')
# touchgrass
svg('touchgrass','<circle cx="32" cy="32" r="30" fill="#5ee7ff"/><path d="M6 50c8-8 14-5 18-12 4 8 12 3 17-4 4 6 8 10 17 8v22H6Z" fill="#5dd16a"/><path d="M16 52c2-10 6-14 10-18M30 54c0-9 2-14 4-18M45 54c-1-9 1-15 5-17" stroke="#2f7a3a" stroke-width="3" stroke-linecap="round"/><path d="M24 26c0-8 16-8 16 0v6H24Z" fill="#ffd7a6"/><path d="M20 20c2-7 11-9 15-3M28 14c2-6 13-5 14 3" fill="none" stroke="#1a0e2c" stroke-width="2.5"/>')
# chungus
svg('chungus','<circle cx="32" cy="32" r="30" fill="#ffb7d5"/><ellipse cx="24" cy="32" rx="5" ry="11" fill="#fff"/><ellipse cx="40" cy="32" rx="5" ry="11" fill="#fff"/><circle cx="24" cy="33" r="2.5" fill="#1a0e2c"/><circle cx="40" cy="33" r="2.5" fill="#1a0e2c"/><ellipse cx="32" cy="42" rx="6" ry="4" fill="#ff7ac8"/><path d="M12 37c2 3 5 4 8 3M52 37c-2 3-5 4-8 3" stroke="#c7608e" stroke-width="2" stroke-linecap="round" fill="none"/>')
# goat
svg('goat','<circle cx="32" cy="32" r="30" fill="#d2a8ff"/><path d="M14 14c-5-6-2-12 0-13 1 6 5 7 9 10M50 14c5-6 2-12 0-13-1 6-5 7-9 10" fill="#7a5230"/><ellipse cx="32" cy="34" rx="18" ry="17" fill="#f2e6ff"/><circle cx="24" cy="31" r="4" fill="#1a0e2c"/><circle cx="40" cy="31" r="4" fill="#1a0e2c"/><path d="M32 38v5M27 43h10" stroke="#1a0e2c" stroke-width="2" fill="none"/>')
# sigma
svg('sigma','<circle cx="32" cy="32" r="30" fill="#171021"/><text x="32" y="45" font-family="Arial Black,sans-serif" font-size="36" font-weight="900" fill="#f0f6fc" text-anchor="middle">Σ</text><path d="M11 18h12v5H11Zm30 0h12v5H41Z" fill="#ffd93d"/>')
# sob alt, based alt, kneel alt etc done
# stickers
def sticker(name, inner, bg='#171021', caption=''):
    cap = f'<text x="128" y="225" font-family="Space Grotesk,Arial,sans-serif" font-size="22" font-weight="900" fill="#f0f6fc" text-anchor="middle">{escape(caption)}</text>' if caption else ''
    inner_big = inner.replace('viewBox="0 0 64 64"','').replace('<svg xmlns="http://www.w3.org/2000/svg"','').replace('</svg>','')
    t = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256"><rect width="256" height="256" rx="24" fill="{bg}"/><g transform="translate(64 20) scale(2)">{inner_big}</g>{cap}</svg>'
    (A/'stickers'/f'{name}.svg').write_text(t + '\n')

for emoji_name, caption, color in [
    ('touchgrass','TOUCH GRASS','#102317'), ('banger','CERTIFIED BANGER','#2a0f12'), ('ratio','L + RATIO','#2b0b0b'),
    ('slop','FRESH SLOP','#1c260b'), ('sus','KINDA SUS','#2d1111'), ('copium','INHALE','#16200f'),
    ('goat','ABSOLUTE GOAT','#241533'), ('goblin','SLOP GOBLIN','#171021')]:
    inner = (A/'emoji'/f'{emoji_name}.svg').read_text()
    sticker(emoji_name, inner, color, caption)
