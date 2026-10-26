import { describe, expect, test, afterAll } from 'bun:test';
import { startTestServer, stopAllServers, makeUsers, createTestServerViaApi, connectWs, waitFor } from '../helpers';

afterAll(() => stopAllServers());

describe('voice', () => {
  test('join, participants, soundboard and leave with realtime events', async () => {
    const server = startTestServer();
    const [admin, member] = (await makeUsers(server, ['voiceadmin', 'voicemember'])) as [any, any];
    const created = await createTestServerViaApi(admin, 'Voice Slop');
    const sid = created.server.id;
    const voice = created.channels.find((c: any) => c.type === 'voice');
    expect(voice).toBeTruthy();
    server.runtime.db.run("INSERT INTO sounds (id, server_id, name, path, emoji, created_at) VALUES ('snd_test', ?, 'Airhorn', '/static/assets/sounds/airhorn.wav', '📢', ?)", sid, Date.now());

    const joinInvite = await admin.post(`/api/channels/${voice.id}/invites`, { maxUses: 0 });
    const code = joinInvite.body.invite.code;
    const joined = await member.post(`/api/invites/${code}`, {});
    expect(joined.status).toBe(200);

    const list = await admin.get(`/api/channels/${voice.id}/voice`);
    expect(list.status).toBe(200);
    expect(list.body.participants).toEqual([]);

    const ws = await connectWs(admin, server);
    const memberWs = await connectWs(member, server);
    await waitFor(ws, (p) => p.t === 'READY');
    await waitFor(memberWs, (p) => p.t === 'READY');

    const join = await admin.post(`/api/channels/${voice.id}/voice/join`, { muted: false, deafened: false });
    expect(join.status).toBe(200);
    expect(join.body.participants.length).toBe(1);
    expect(join.body.participants[0].user.username).toBe('voiceadmin');
    expect(Array.isArray(join.body.iceServers)).toBe(true);

    const stateWait = waitFor(ws, (p) => p.t === 'VOICE_STATE' && p.d?.userId === member.userId);
    const joinMember = await member.post(`/api/channels/${voice.id}/voice/join`, { muted: true });
    expect(joinMember.status).toBe(200);
    expect(joinMember.body.participants.length).toBe(2);
    const stateEvent = await stateWait;
    expect(stateEvent.d.action).toBe('join');
    expect(stateEvent.d.muted).toBe(true);

    const sounds = await admin.get(`/api/channels/${voice.id}/soundboard`);
    expect(sounds.status).toBe(200);
    expect(sounds.body.sounds.some((s: any) => s.id === 'snd_test')).toBe(true);
    const soundWait = waitFor(ws, (p) => p.t === 'VOICE_SOUND');
    const played = await member.post(`/api/channels/${voice.id}/soundboard/snd_test/play`);
    expect(played.status).toBe(200);
    expect(played.body.url).toContain('/static/assets/sounds/');
    const soundEvent = await soundWait;
    expect(soundEvent.d.name).toBe('Airhorn');

    const update = await admin.patch(`/api/channels/${voice.id}/voice/state`, { muted: true, deafened: true });
    expect(update.status).toBe(200);
    const leaveWait = waitFor(ws, (p) => p.t === 'VOICE_STATE' && p.d?.userId === member.userId && p.d.action === 'leave');
    const leave = await member.post(`/api/channels/${voice.id}/voice/leave`);
    expect(leave.status).toBe(200);
    const leaveEvent = await leaveWait;
    expect(leaveEvent).toBeTruthy();

    ws.close(); memberWs.close();
  });

  test('outsiders and text channels are rejected', async () => {
    const server = startTestServer();
    const [admin, outsider] = (await makeUsers(server, ['vcowner', 'vcoutsider'])) as [any, any];
    const created = await createTestServerViaApi(admin, 'Private Voice');
    const voice = created.channels.find((c: any) => c.type === 'voice');
    const text = created.channels.find((c: any) => c.type === 'text');
    const noAccess = await outsider.get(`/api/channels/${voice.id}/voice`);
    expect(noAccess.status).toBe(404);
    const wrongType = await admin.get(`/api/channels/${text.id}/voice`);
    expect(wrongType.status).toBe(400);
    const notInVoice = await admin.post(`/api/channels/${voice.id}/soundboard/snd_test/play`);
    expect(notInVoice.status).toBe(409);
  });
});
