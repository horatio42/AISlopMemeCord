export interface AchievementDef { key: string; name: string; description: string; emoji: string }

export const ACHIEVEMENTS: AchievementDef[] = [
  { key: 'founder', name: 'Founder', description: 'Created the instance. Congratulations, you are the slop overload.', emoji: '\ud83d\udc51' },
  { key: 'first_message', name: 'Hello, Slop', description: 'Sent your first message.', emoji: '\ud83d\udc4b' },
  { key: 'shitposter', name: 'Certified Shitposter', description: 'Sent 100 messages. Seek help.', emoji: '\ud83d\udca9' },
  { key: 'reaction_goblin', name: 'Reaction Goblin', description: 'Gave 50 reactions.', emoji: '\ud83d\udc38' },
  { key: 'based', name: 'Based', description: 'Accumulated 100 Slop Points.', emoji: '\ud83d\ude4c' },
  { key: 'ratio', name: 'Ratioed', description: 'A message of yours hit -10 Slop Points.', emoji: '\ud83d\udcc9' },
  { key: 'night_owl', name: 'Night Owl', description: 'Posted between 2am and 5am. Go to sleep.', emoji: '\ud83c\udf19' },
  { key: 'server_owner', name: 'Landlord', description: 'Created a server.', emoji: '\ud83c\udfe0' },
  { key: 'friend', name: 'Touch Grass Adjacent', description: 'Made a friend online.', emoji: '\ud83e\udd1d' },
  { key: 'copypasta', name: 'Pasta Chef', description: 'Used the copypasta button.', emoji: '\ud83c\udf5d' },
  { key: 'voice', name: 'Voice Unlocked', description: 'Joined a voice channel.', emoji: '\ud83c\udfa4' },
  { key: 'e2ee', name: 'Secret Slop', description: 'Sent an end-to-end encrypted DM.', emoji: '\ud83d\udd10' },
  { key: 'slop_goblin', name: 'Slop Goblin', description: 'Earned 10 achievements. This is your identity now.', emoji: '\ud83d\udc7a' },
  { key: 'emoji_hoarder', name: 'Emoji Hoarder', description: 'Uploaded 10 custom emojis.', emoji: '\ud83d\ude00' },
  { key: 'moderator', name: 'Janitor', description: 'Took a moderation action.', emoji: '\ud83e\uddf9' },
];

export const AWARDS = [
  { key: 'based', name: 'Based', emoji: '\ud83d\ude4c', color: '#ff7a00', description: 'For a truly based take.' },
  { key: 'banger', name: 'Banger', emoji: '\ud83d\udd25', color: '#ff3050', description: 'This one slaps.' },
  { key: 'copium', name: 'Copium', emoji: '\ud83e\udd27', color: '#7ee787', description: 'Inhale the copium.' },
  { key: 'touch_grass', name: 'Touch Grass', emoji: '\ud83c\udf3f', color: '#3fb950', description: 'Go outside. Immediately.' },
  { key: 'ratio', name: 'Ratio', emoji: '\ud83d\udcc9', color: '#f85149', description: 'L + ratio + no bitches.' },
  { key: 'sus', name: 'Sus', emoji: '\ud83d\udd0e', color: '#f0c000', description: 'Kind of sus, ngl.' },
  { key: 'goat', name: 'GOAT', emoji: '\ud83d\udc10', color: '#d2a8ff', description: 'Greatest of all time.' },
  { key: 'cursed', name: 'Cursed', emoji: '\ud83d\udc80', color: '#a371f7', description: 'Cursed content. Do not open.' },
  { key: 'wholesome', name: 'Wholesome', emoji: '\ud83e\udd70', color: '#6cb6ff', description: 'A speck of kindness in the slop.' },
  { key: 'kneel', name: 'Kneel', emoji: '\ud83d\udc51', color: '#e3b341', description: 'Bow before the slop overload.' },
];

export const COPYPASTAS: string[] = [
  "I am once again asking for your financial support.",
  "Nobody asked, but here we are.",
  "This is the content I come here for.",
  "It's giving unhinged. It's giving slop. It's giving everything.",
  "I will not be taking questions at this time.",
  "The slop must flow.",
  "Certified banger. No notes.",
  "I'm not reading all that. Happy for you though. Or sorry that happened.",
  "Tell me you have never used a chat app without telling me you have never used a chat app.",
  "This is a Wendy's.",
  "Skill issue.",
  "The mitochondria is the powerhouse of the cell.",
  "I'm something of a scientist myself.",
  "You either die a lurker or live long enough to see yourself become the shitposter.",
  "It's not a phase, mom. It's a lifestyle.",
  "This server has big 'last place in the group project' energy.",
  "I diagnose you with slop. Terminal slop. Untreatable.",
  "POV: you are reading this copypasta and procrastinating.",
  "Not the heccin slopparino.",
  "The council will decide your fate. The council is a Discord bot with a stutter.",
  "No thoughts. Head empty. Just slop.",
  "One does not simply lurk in the Slop Pit.",
  "I came here to laugh at memes and chew bubblegum, and I'm all out of bubblegum.",
  "We do a little shitposting.",
  "It's sloppin' time.",
  "You have been visited by the Slop Goblin. Reply 'slop' within 5 seconds or your karma will be mid.",
  "Per my last message, I am still not reading all that.",
  "This is why we can't have nice things.",
  "Have you tried turning it off and on again? No? Then perish.",
  "Local man discovers chat app, immediately regrets it.",
  "AI-generated garbage is the highest form of art. This is not up for debate.",
  "The Slop Pit is a society. A broken, beautiful society.",
  "Ain't no way bro just said that.",
  "There are two wolves inside you. Both are posting cringe.",
  "Bro really hit the 'send' button on that one.",
  "My brother in slop, it is 4am. Please stop.",
  "I'm not saying it was aliens, but it was aliens.",
  "This is the slop equivalent of a TED talk.",
  "The vibe is off. The slop is on. Proceed.",
  "Touch grass simulator 2026.",
  "I could fix him, but honestly? The slop is more entertaining.",
];

export const SLOP_METER_PHRASES = [
  'Certified banger. Frame it.',
  'Absolute slop. Chef\u2019s kiss.',
  'Mildly unhinged. Proceed with caution.',
  'This is basically a Sean Cody script with fewer vowels.',
  'The council is divided. The slop is not.',
  'Emotionally devastating. 10/10 would read again.',
  'This has big "reply guy" energy.',
  'I felt my brain cells doing the Macarena.',
  'Deeply cursed. Please continue.',
  'This could have been a DM. Instead it is art.',
];

export function slopMeter(text: string): { score: number; verdict: string; breakdown: { label: string; value: number }[]; words: number; capsRatio: number; exclamations: number; emojis: number } {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const caps = (text.match(/[A-Z]/g) ?? []).length;
  const letters = (text.match(/[A-Za-z]/g) ?? []).length;
  const capsRatio = letters ? caps / letters : 0;
  const exclamations = (text.match(/!/g) ?? []).length;
  const emojis = [...text].filter((c) => /\p{Extended_Pictographic}/u.test(c)).length;
  const memeWords = ['slop', 'based', 'ratio', 'sus', 'copium', 'cringe', 'meme', 'goblin', 'skibidi', 'rizz', 'sigma', 'chungus', 'bruh', 'sigma', 'ahh'];
  const lower = text.toLowerCase();
  const memeHits = memeWords.reduce((n, w) => n + (lower.includes(w) ? 1 : 0), 0);
  const lettersOnly = lower.replace(/[^a-z]/g, '');
  const slopScore = Math.min(100, Math.round(
    Math.min(words, 80) * 0.6 + capsRatio * 18 + Math.min(exclamations, 8) * 2 + Math.min(emojis, 10) * 1.5 +
    memeHits * 4 + (lettersOnly.length > 100 ? 8 : 0) + (text.includes('?') && text.includes('!') ? 4 : 0),
  ));
  const verdict = slopScore > 80 ? 'Peak slop. Scientists should study this.' : slopScore > 55 ? 'Dangerously sloppy.' : slopScore > 30 ? 'Moderately sloppy. Respectable.' : 'Suspiciously coherent. Are you a bot?';
  return { score: slopScore, verdict, breakdown: [
    { label: 'word count', value: Math.min(words, 80) },
    { label: 'scream ratio', value: Math.round(capsRatio * 100) },
    { label: 'exclamations', value: exclamations },
    { label: 'emojis', value: emojis },
    { label: 'meme density', value: memeHits },
  ], words, capsRatio, exclamations, emojis };
}

export function generateSlop(seed = '', paragraphs = 3): string {
  const pick = (arr: string[], salt: number) => arr[(seed.length + salt * 7 + arr.length) % arr.length]!;
  const openers = ['Listen.', 'Hot take:', 'Breaking: local man discovers', 'Scientists confirm that', 'You will not believe what happened when', 'Source: trust me bro.', 'POV: you are', 'Not gonna lie,', 'Unpopular opinion:', 'I am legally required to inform you that'];
  const nouns = ['the slop goblin', 'this Discord server', 'my sleep schedule', 'the concept of grass', 'AI-generated memes', 'the group chat', 'a single brain cell', 'the last slice of pizza', 'the local mall', 'my will to live'];
  const verbs = ['ate', 'ratioed', 'gaslit', 'speedran', 'cooked', 'yeeted', 'diagnosed', 'touched', 'vaporized', 'befriended'];
  const endings = ['and I am tired of pretending it did not.', 'It changed everything.', 'The council has been notified.', 'Nobody was surprised.', 'This is the future liberals want.', 'Please do not contact me.', 'Sources say the vibes were immaculate.', 'We live in a society.', 'It was the best of times, it was the sloppiest of times.'];
  let out = seed ? `[continued] ${seed}. ` : '';
  const paras: string[] = [];
  for (let p = 0; p < paragraphs; p++) {
    const sentences: string[] = [];
    for (let s = 0; s < 3; s++) {
      const salt = p * 7 + s;
      sentences.push(`${pick(openers, salt)} ${pick(nouns, salt + 2)} ${pick(verbs, salt + 3)} ${pick(nouns, salt + 5)} ${pick(endings, salt + 4)}`);
    }
    paras.push(sentences.join(' '));
  }
  out += paras.join('\n\n');
  return out.slice(0, 1900);
}
