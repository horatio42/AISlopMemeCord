import { useEffect, useState } from 'preact/hooks';
import { api, errorMessage } from '../../../../lib/api';
import { store, useApp } from '../../../../lib/use-store';
import { can } from '../../../../lib/permissions';
import { Perm } from '../../../../../shared/permissions';
import type { ServerEvent } from '../../../../../shared/types';
import { fmtDateTime, fmtRelative } from '../../../../lib/format';
import { Avatar } from '../../../Avatar';
import { Icon } from '../../../Icons';
import { Field } from '../../../Ui';
import { EmptySlop, SettingsError, SettingsNotice, SettingsSection, SubCard, UploadControl } from './shared';

function toLocalInput(ts: number | null): string {
  if (!ts) return '';
  const d = new Date(ts - new Date(ts).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}

interface EventDraft {
  name: string;
  description: string;
  channelId: string;
  startsAt: string;
  endsAt: string;
  cover: string | null;
  coverDirty: boolean;
}

const newDraft = (): EventDraft => ({
  name: '', description: '', channelId: '', startsAt: toLocalInput(Date.now() + 3_600_000), endsAt: '', cover: null, coverDirty: false,
});

export function EventsTab({ serverId }: { serverId: string }) {
  const state = useApp();
  const bundle = state.servers[serverId];
  const createPermission = can(state, Perm.CREATE_EVENTS, serverId);
  const manageServer = can(state, Perm.MANAGE_SERVER, serverId);
  const [events, setEvents] = useState<ServerEvent[]>([]);
  const [draft, setDraft] = useState<EventDraft>(newDraft());
  const [editing, setEditing] = useState<ServerEvent | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);

  useEffect(() => {
    void api.get<{ events: ServerEvent[] }>(`/api/servers/${serverId}/events`)
      .then((r) => setEvents(r.events ?? []))
      .catch((e) => setError(errorMessage(e)));
  }, [serverId]);

  if (!bundle) return <SettingsError message="Events are currently imaginary." />;

  const channels = bundle.channels.filter((c) => c.type !== 'category' && c.type !== 'thread').sort((a, b) => a.position - b.position);
  const canEdit = (e: ServerEvent) => e.creator.id === state.user?.id || manageServer;

  const openCreate = () => {
    setEditing(null); setDraft(newDraft()); setFormOpen(true); setError('');
  };
  const openEdit = (event: ServerEvent) => {
    setEditing(event);
    setDraft({
      name: event.name, description: event.description ?? '', channelId: event.channelId ?? '',
      startsAt: toLocalInput(event.startsAt), endsAt: toLocalInput(event.endsAt), cover: event.cover, coverDirty: false,
    });
    setFormOpen(true); setError('');
  };

  const save = async () => {
    if (!draft.name.trim()) { setError('Events need a name. "Thing" counts, barely.'); return; }
    const start = new Date(draft.startsAt).getTime();
    if (!Number.isFinite(start) || start <= 0) { setError('Pick a valid start time.'); return; }
    const end = draft.endsAt ? new Date(draft.endsAt).getTime() : null;
    if (end !== null && (!Number.isFinite(end) || end < start)) { setError('Events cannot end before they start. Time travel is out of scope.'); return; }
    setBusy(true); setError('');
    try {
      const body: Record<string, unknown> = {
        name: draft.name.trim(), description: draft.description.trim() || null,
        channelId: draft.channelId || null, startsAt: start, endsAt: end,
      };
      if (draft.coverDirty) body.cover = draft.cover;
      if (editing) {
        const res = await api.patch<{ event: ServerEvent }>(`/api/events/${editing.id}`, body);
        setEvents((old) => old.map((e) => e.id === res.event.id ? res.event : e));
        store.toast('Event updated. The calendar has been slopped.', 'success', '📅');
      } else {
        const res = await api.post<{ event: ServerEvent }>(`/api/servers/${serverId}/events`, body);
        setEvents((old) => [...old, res.event].sort((a, b) => a.startsAt - b.startsAt));
        store.toast('Event created. Attendance is optional, FOMO is not.', 'success', '📅');
      }
      setFormOpen(false); setEditing(null); setDraft(newDraft());
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    setBusy(true); setError('');
    try {
      await api.del(`/api/events/${id}`);
      setEvents((old) => old.filter((e) => e.id !== id));
      setConfirm(null);
      if (editing?.id === id) { setEditing(null); setFormOpen(false); }
      store.toast('Event deleted. The memory remains.', 'success', '🗑️');
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const rsvp = async (event: ServerEvent, status: 'interested' | 'going' | null) => {
    setError('');
    try {
      const res = await api.post<{ event: ServerEvent }>(`/api/events/${event.id}/rsvp`, { status });
      setEvents((old) => old.map((e) => e.id === res.event.id ? res.event : e));
    } catch (e) { setError(errorMessage(e)); }
  };

  return <SettingsSection
    title="Server events"
    desc="Scheduled chaos. RSVP is a social contract with no legal weight."
    actions={createPermission ? <button class="btn btn-primary btn-sm" onClick={openCreate}><Icon name="plus" size={13} /> Create event</button> : undefined}
  >
    <SettingsError message={error} />
    {!createPermission ? <SettingsNotice kind="warn">You need <span class="mono">Create Events</span> to schedule things. You may still RSVP, which is mostly vibes.</SettingsNotice> : null}

    {formOpen ? <SubCard title={editing ? `Edit event — ${editing.name}` : 'New event'} actions={<button class="btn btn-sm btn-ghost" onClick={() => { setFormOpen(false); setEditing(null); }}>Close</button>}>
      <div class="srv-grid-2">
        <Field label="Event name" hint="1-100 characters.">
          <input class="input" value={draft.name} maxLength={100} onInput={(e) => setDraft({ ...draft, name: (e.target as HTMLInputElement).value })} placeholder="Friday Night Slop" />
        </Field>
        <Field label="Channel" hint="Optional. Voice or text, wherever the chaos happens.">
          <select class="select" value={draft.channelId} onChange={(e) => setDraft({ ...draft, channelId: (e.target as HTMLSelectElement).value })}>
            <option value="">— no channel —</option>
            {channels.map((c) => <option value={c.id}>{c.type === 'voice' ? '🔊' : '#'} {c.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Description" hint="1000 characters of agenda, lore or nonsense.">
        <textarea class="textarea" value={draft.description} maxLength={1000} onInput={(e) => setDraft({ ...draft, description: (e.target as HTMLTextAreaElement).value })} style={{ minHeight: 70 }} />
      </Field>
      <div class="srv-grid-2">
        <Field label="Starts" hint="Local time, converted to epoch ms on the wire.">
          <input class="input" type="datetime-local" value={draft.startsAt} onInput={(e) => setDraft({ ...draft, startsAt: (e.target as HTMLInputElement).value })} />
        </Field>
        <Field label="Ends" hint="Optional. Leave blank for the eternal event.">
          <input class="input" type="datetime-local" value={draft.endsAt} onInput={(e) => setDraft({ ...draft, endsAt: (e.target as HTMLInputElement).value })} />
        </Field>
      </div>
      <UploadControl
        purpose="event_cover"
        value={draft.cover}
        onChange={(v) => setDraft({ ...draft, cover: v, coverDirty: true })}
        label="Event cover"
        hint="Up to 5MB. Rendered as a wide banner on the event card."
        maxMb={5}
        size={64}
      />
      <div class="row gap-8 mt-16">
        <button class="btn btn-primary" disabled={busy || !draft.name.trim()} onClick={() => void save()}>{busy ? 'Saving…' : editing ? 'Save event' : 'Create event'}</button>
        <button class="btn btn-ghost" onClick={() => { setFormOpen(false); setEditing(null); setDraft(newDraft()); }}>Cancel</button>
      </div>
    </SubCard> : null}

    {events.length ? <div class="srv-event-list">
      {events.map((event) => {
        const past = (event.endsAt ?? event.startsAt) < Date.now();
        return <div class={`srv-event ${past ? 'past' : ''}`} key={event.id}>
          <div class="srv-event-cover" style={event.cover ? { backgroundImage: `url(${event.cover})` } : undefined}>
            {!event.cover ? <span>📅</span> : null}
          </div>
          <div class="srv-event-body">
            <div class="row-between">
              <div class="srv-event-title">{event.name}{past ? <span class="badge" style={{ marginLeft: 6 }}>past</span> : null}</div>
              {canEdit(event) ? <div class="row gap-4">
                <button class="btn-icon sm" title="Edit event" onClick={() => openEdit(event)}><Icon name="edit" size={13} /></button>
                {confirm === event.id
                  ? <><button class="btn btn-xs btn-danger" disabled={busy} onClick={() => void remove(event.id)}>Delete</button><button class="btn btn-xs btn-ghost" onClick={() => setConfirm(null)}>Keep</button></>
                  : <button class="btn-icon sm" title="Delete event" onClick={() => setConfirm(event.id)}><Icon name="trash" size={13} /></button>}
              </div> : null}
            </div>
            {event.description ? <p class="srv-event-desc">{event.description}</p> : null}
            <div class="srv-hint">
              {fmtDateTime(event.startsAt)}{event.endsAt ? ` → ${fmtDateTime(event.endsAt)}` : ''}
              {event.channelId ? ` · ${bundle.channels.find((c) => c.id === event.channelId)?.name ?? 'channel'}` : ''}
              {' · '}{event.counts.going} going · {event.counts.interested} interested
            </div>
            <div class="row-between mt-8">
              <div class="row gap-8">
                <Avatar user={event.creator} size={20} status={false} /><span class="srv-hint">by {event.creator.displayName} · {fmtRelative(event.startsAt)}</span>
              </div>
              <div class="segmented">
                <button class={event.rsvp === 'going' ? 'active' : ''} onClick={() => void rsvp(event, event.rsvp === 'going' ? null : 'going')}>Going ({event.counts.going})</button>
                <button class={event.rsvp === 'interested' ? 'active' : ''} onClick={() => void rsvp(event, event.rsvp === 'interested' ? null : 'interested')}>Interested ({event.counts.interested})</button>
              </div>
            </div>
          </div>
        </div>;
      })}
    </div> : <EmptySlop emoji="📅" title="No events scheduled">The calendar is a blank void. Fill it with obligations you will ignore.</EmptySlop>}
  </SettingsSection>;
}
