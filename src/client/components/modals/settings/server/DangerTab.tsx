import { useState } from 'preact/hooks';
import { api, errorMessage } from '../../../../lib/api';
import { store, useApp } from '../../../../lib/use-store';
import { isOwner } from '../../../../lib/permissions';
import { Field } from '../../../Ui';
import { Icon } from '../../../Icons';
import { SettingsError, SettingsNotice, SettingsSection, SubCard } from './shared';

export function DangerTab({ serverId, onClose }: { serverId: string; onClose: () => void }) {
  const state = useApp();
  const bundle = state.servers[serverId];
  const [transferTo, setTransferTo] = useState('');
  const [confirmTransfer, setConfirmTransfer] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteName, setDeleteName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!bundle) return <SettingsError message="This server is already gone. The danger tab is ahead of schedule." />;

  const { server } = bundle;
  const owner = isOwner(state, serverId);
  const actualOwner = state.user?.id === server.ownerId;
  const memberOptions = bundle.members.filter((m) => m.user.id !== server.ownerId);

  const goHome = async () => {
    await store.loadWorkspace();
    await store.applyRoute('/', true);
    onClose();
  };

  const transfer = async () => {
    if (!transferTo) { setError('Pick a member to inherit the throne.'); return; }
    setBusy(true); setError('');
    try {
      await api.post(`/api/servers/${serverId}/transfer`, { userId: transferTo });
      await store.loadServer(serverId, { force: true });
      setTransferTo(''); setConfirmTransfer(false);
      store.toast('Ownership transferred. The crown has a new headache.', 'success', '👑');
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const leave = async () => {
    setBusy(true); setError('');
    try {
      await api.post(`/api/servers/${serverId}/leave`);
      store.toast('You left the server. The door hit you on the way out.', 'success', '🚪');
      await goHome();
    } catch (e) { setError(errorMessage(e)); setBusy(false); }
  };

  const destroy = async () => {
    if (deleteName !== server.name) { setError('Type the exact server name. The slop demands precision.'); return; }
    setBusy(true); setError('');
    try {
      await api.del(`/api/servers/${serverId}`, { confirmName: deleteName });
      store.toast('Server deleted. It is now a cautionary tale.', 'success', '💀');
      await goHome();
    } catch (e) { setError(errorMessage(e)); setBusy(false); }
  };

  return <SettingsSection title="Danger zone" desc="The irreversible part of the settings menu. Read twice; click once.">
    <SettingsError message={error} />
    <SettingsNotice kind="warn">
      There is no undo, no recycle bin and no admin magic that restores a deleted server. Export anything you care about first.
    </SettingsNotice>

    {actualOwner ? <SubCard title="Transfer ownership" actions={<span class="badge purple">owner only</span>}>
      <p class="srv-hint mb-16">Hand the server to another member. The Founder role moves with the crown; you lose owner-only powers immediately.</p>
      {memberOptions.length ? <>
        <div class="row gap-8 wrap">
          <select class="select" value={transferTo} style={{ maxWidth: 320 }} onChange={(e) => { setTransferTo((e.target as HTMLSelectElement).value); setConfirmTransfer(false); }}>
            <option value="">— pick the next monarch —</option>
            {memberOptions.map((m) => <option value={m.user.id}>{m.user.displayName} (@{m.user.username})</option>)}
          </select>
          {!confirmTransfer ? <button class="btn btn-sm" disabled={busy || !transferTo} onClick={() => setConfirmTransfer(true)}>Transfer…</button> : <>
            <button class="btn btn-sm btn-danger" disabled={busy || !transferTo} onClick={() => void transfer()}>Confirm transfer</button>
            <button class="btn btn-sm btn-ghost" onClick={() => setConfirmTransfer(false)}>Cancel</button>
          </>}
        </div>
        {confirmTransfer ? <div class="srv-hint mt-8">This is permanent until the new owner transfers it back. Choose wisely.</div> : null}
      </> : <div class="srv-hint">No other members exist. You are alone with the throne. Recruit someone first.</div>}
    </SubCard> : null}

    {!actualOwner ? <SubCard title="Leave server">
      <p class="srv-hint mb-16">Leave voluntarily. Your messages stay behind, immortal and slightly embarrassing.</p>
      {!confirmLeave ? <button class="btn btn-sm" disabled={busy} onClick={() => setConfirmLeave(true)}><Icon name="logout" size={13} /> Leave server</button> : <div class="row gap-8">
        <button class="btn btn-sm btn-danger" disabled={busy} onClick={() => void leave()}>{busy ? 'Leaving…' : 'Confirm leave'}</button>
        <button class="btn btn-sm btn-ghost" onClick={() => setConfirmLeave(false)}>Stay</button>
      </div>}
    </SubCard> : null}

    {actualOwner ? <SubCard title="Leave server" actions={<span class="badge">blocked</span>}>
      <p class="srv-hint">The owner cannot leave without first transferring ownership. The throne needs a warm body. Transfer above, then leave in peace.</p>
    </SubCard> : null}

    {owner ? <SubCard title="Delete server" actions={<span class="badge danger">irreversible</span>}>
      <p class="srv-hint mb-16">Deletes <strong>{server.name}</strong>, every channel, message, role, asset, invite and event. Members are not notified individually; the server simply stops existing.</p>
      {!confirmDelete ? <button class="btn btn-sm btn-danger" disabled={busy} onClick={() => { setConfirmDelete(true); setDeleteName(''); }}><Icon name="trash" size={13} /> Delete this server</button> : <div class="srv-confirm">
        <Field label={`Type "${server.name}" to confirm`} hint="Exact spelling, exact case. No copy-paste moral support.">
          <input class="input" value={deleteName} onInput={(e) => setDeleteName((e.target as HTMLInputElement).value)} placeholder={server.name} autocomplete="off" />
        </Field>
        <div class="row gap-8">
          <button class="btn btn-sm btn-danger" disabled={busy || deleteName !== server.name} onClick={() => void destroy()}>{busy ? 'Deleting…' : 'Delete forever'}</button>
          <button class="btn btn-sm btn-ghost" onClick={() => { setConfirmDelete(false); setDeleteName(''); }}>Cancel</button>
        </div>
      </div>}
    </SubCard> : null}

    {!owner && !actualOwner ? <SettingsNotice>Only the owner or an instance admin can delete this server. You can still leave above.</SettingsNotice> : null}
  </SettingsSection>;
}
