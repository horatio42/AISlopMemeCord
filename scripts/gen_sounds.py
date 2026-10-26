#!/usr/bin/env python3
"""Synthesize original 8-bit meme soundboard clips. No sample libraries."""
import math, random, struct, wave
from pathlib import Path
A = Path(__file__).resolve().parent.parent / 'src' / 'assets' / 'sounds'
A.mkdir(parents=True, exist_ok=True)
SR = 22050
random.seed(42)

def env(t, dur, attack=.01, release=.08):
    if t < attack: return t / attack
    if t > dur - release: return max(0, (dur - t) / release)
    return 1

def tone(freq, dur, kind='square', vol=.5, slide=None, wobble=0):
    n = int(SR * dur); out=[]
    phase=0.0
    for i in range(n):
        t=i/SR
        f = freq if slide is None else freq + (slide-freq)*t/dur
        if wobble: f += math.sin(t*2*math.pi*wobble)*freq*.08
        phase += 2*math.pi*f/SR
        v = math.sin(phase) if kind=='sine' else (1 if math.sin(phase)>=0 else -1) if kind=='square' else (2*((phase/(2*math.pi))%1)-1)
        out.append(v*vol*env(t,dur))
    return out

def noise(dur, vol=.4, lowpass=1):
    n=int(SR*dur); out=[]; prev=0
    for i in range(n):
        t=i/SR; v=random.uniform(-1,1); prev=prev+(v-prev)*lowpass
        out.append(prev*vol*env(t,dur,.005,.05))
    return out

def silence(ms): return [0.0]*int(SR*ms/1000)
def mix(*tracks):
    n=max(len(t) for t in tracks); out=[0.0]*n
    for t in tracks:
        for i,v in enumerate(t): out[i]+=v
    return [max(-1,min(1,v)) for v in out]

def seq(parts):
    out=[]
    for p in parts: out.extend(p)
    return out

def write(name, samples):
    peak=max(1e-6,max(abs(x) for x in samples)); scale=.85/peak
    with wave.open(str(A/f'{name}.wav'),'wb') as f:
        f.setnchannels(1); f.setsampwidth(2); f.setframerate(SR)
        f.writeframes(b''.join(struct.pack('<h', int(x*scale*32767)) for x in samples))

write('airhorn', seq([tone(440,.18,'square',.4,520), tone(520,.18,'square',.4,440), tone(390,.55,'square',.45,520), silence(30)]))
write('bruh', seq([tone(140,.16,'saw' if False else 'square',.35,110), tone(100,.28,'square',.3,75), silence(20)]))
write('vine-boom', mix(tone(80,.7,'sine',.7,45), noise(.7,.25,.06)))
write('among-us', seq([tone(311,.09,'square',.35),tone(370,.09,'square',.35),tone(415,.16,'square',.4),tone(311,.1,'square',.3),silence(25)]))
write('bonk', mix(tone(180,.12,'sine',.6,55), noise(.12,.5,.5)))
write('yeet', seq([noise(.05,.2,.2), tone(200,.35,'square',.35,900), silence(15)]))
write('error', seq([tone(660,.12,'square',.3), tone(880,.12,'square',.3), tone(660,.12,'square',.3), tone(440,.3,'square',.3)]))
write('dialup', seq([noise(.35,.15,.08), tone(1200,.15,'sine',.2), tone(2100,.15,'sine',.2), noise(.5,.18,.03), tone(300,.2,'square',.15)]))
write('fart', mix(tone(65,.5,'square',.4,40,7), noise(.4,.15,.05)))
write('rimshot', seq([noise(.04,.4,.7), noise(.04,.35,.5), tone(880,.2,'sine',.25,440)]))
write('oof', seq([tone(420,.08,'square',.3,300), silence(30), noise(.1,.3,.4)]))
write('pog', seq([tone(523,.06,'square',.28),tone(659,.06,'square',.28),tone(784,.12,'square',.32),silence(20)]))
write('slop', seq([tone(130,.35,'sine',.4,90,4), tone(110,.2,'sine',.3,70,5)]))
print('sounds:', sorted(p.name for p in A.glob('*.wav')))
