import { useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { uploadFile, errorMessage } from '../../../../lib/api';
import { store } from '../../../../lib/use-store';
import { Icon } from '../../../Icons';
import { Spinner } from '../../../Ui';
import { Perm, PERMISSION_META, PERMISSION_NAMES, PERMISSION_PRESETS, has } from '../../../../../shared/permissions';
import type { PermissionName } from '../../../../../shared/permissions';

export function SettingsSection(props: { title: string; desc?: string; children: ComponentChildren; actions?: ComponentChildren }) {
  return <div class="srv-section">
    <div class="row-between srv-section-head">
      <div>
        <h3>{props.title}</h3>
        {props.desc ? <p class="settings-desc">{props.desc}</p> : null}
      </div>
      {props.actions ? <div class="row gap-8">{props.actions}</div> : null}
    </div>
    {props.children}
  </div>;
}

export function SubCard(props: { title?: ComponentChildren; children: ComponentChildren; class?: string; actions?: ComponentChildren }) {
  return <div class={`srv-card ${props.class ?? ''}`}>
    {props.title || props.actions ? <div class="row-between srv-card-head"><div class="srv-card-title">{props.title}</div>{props.actions ? <div class="row gap-8">{props.actions}</div> : null}</div> : null}
    {props.children}
  </div>;
}

export function SettingsError({ message }: { message?: string | null }) {
  if (!message) return null;
  return <div class="srv-error" role="alert"><Icon name="alert" size={15} /><span>{message}</span></div>;
}

export function SettingsNotice({ children, kind = 'info' }: { children: ComponentChildren; kind?: 'info' | 'warn' }) {
  return <div class={`srv-notice ${kind}`}><Icon name={kind === 'warn' ? 'alert' : 'info'} size={15} /><span>{children}</span></div>;
}

export function EmptySlop({ emoji = '🫠', title, children }: { emoji?: string; title: string; children?: ComponentChildren }) {
  return <div class="srv-empty"><div class="srv-empty-emoji">{emoji}</div><div class="srv-empty-title">{title}</div>{children ? <div class="srv-empty-desc">{children}</div> : null}</div>;
}

export function SettingsLoading({ label = 'Summoning settings…' }: { label?: string }) {
  return <div class="srv-loading"><Spinner /><span class="muted">{label}</span></div>;
}

export function SmallButton(props: { icon?: string; children?: ComponentChildren; onClick: () => void; disabled?: boolean; danger?: boolean; title?: string; class?: string; active?: boolean }) {
  return <button
    class={`btn btn-sm ${props.danger ? 'btn-danger' : ''} ${props.active ? 'srv-active-btn' : ''} ${props.class ?? ''}`}
    onClick={props.onClick}
    disabled={props.disabled}
    title={props.title}
  >
    {props.icon ? <Icon name={props.icon} size={13} /> : null}
    {props.children}
  </button>;
}

/** File picker with live preview and upload feedback. Uses the media upload API. */
export function UploadControl(props: {
  purpose: string;
  value: string | null;
  onChange: (url: string | null) => void;
  accept?: string;
  label?: string;
  hint?: string;
  square?: boolean;
  size?: number;
  round?: boolean;
  maxMb?: number;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const size = props.size ?? 72;
  const pick = async (file?: File) => {
    if (!file) return;
    if (props.maxMb && file.size > props.maxMb * 1024 * 1024) { setError(`Keep it under ${props.maxMb}MB. The slop budget is finite.`); return; }
    setBusy(true); setError('');
    try {
      const up = await uploadFile(file, props.purpose);
      props.onChange(up.url);
      store.toast('Uploaded. The void accepted your offering.', 'success', '📼');
    } catch (e) {
      setError(errorMessage(e));
    } finally { setBusy(false); if (ref.current) ref.current.value = ''; }
  };
  return <div class="srv-upload">
    <button
      type="button"
      class={`srv-upload-preview ${props.round ? 'round' : ''} ${props.square ? 'square' : ''}`}
      style={{ width: `${size}px`, height: `${size}px` }}
      onClick={() => ref.current?.click()}
      disabled={props.disabled || busy}
      title={props.label ?? 'Upload image'}
    >
      {props.value ? <img src={props.value} alt="" /> : <span>{busy ? <Spinner size={16} /> : <Icon name="image" size={22} />}</span>}
      {!busy && props.value ? <span class="srv-upload-overlay">change</span> : null}
    </button>
    <div class="grow">
      <div class="row gap-8 wrap">
        <button type="button" class="btn btn-sm" onClick={() => ref.current?.click()} disabled={props.disabled || busy}>
          {busy ? <Spinner size={12} /> : <Icon name="download" size={13} />} {props.label ?? 'Upload image'}
        </button>
        {props.value ? <button type="button" class="btn btn-sm btn-ghost" onClick={() => props.onChange(null)} disabled={props.disabled}>Remove</button> : null}
      </div>
      {props.hint ? <div class="srv-hint">{props.hint}</div> : null}
      {error ? <div class="srv-error inline">{error}</div> : null}
    </div>
    <input ref={ref} hidden type="file" accept={props.accept ?? 'image/*'} onChange={(e) => void pick((e.target as HTMLInputElement).files?.[0])} />
  </div>;
}

const GROUPS = ['General', 'Moderation', 'Text', 'Voice'] as const;

export function PermissionEditor(props: { permissions: number; onChange: (v: number) => void; disabled?: boolean }) {
  const toggle = (name: PermissionName) => {
    const bit = Perm[name];
    props.onChange(has(props.permissions, bit) ? props.permissions & ~bit : props.permissions | bit);
  };
  return <div class="srv-perms">
    <div class="row gap-8 wrap mb-16">
      <span class="srv-hint" style={{ marginRight: 4 }}>Presets:</span>
      {Object.entries(PERMISSION_PRESETS).map(([name, mask]) => <button key={name} class="chip" disabled={props.disabled} onClick={() => props.onChange(mask)}>{name}</button>)}
      <button class="chip" disabled={props.disabled} onClick={() => props.onChange(0)}>None</button>
    </div>
    {GROUPS.map((group) => {
      const names = PERMISSION_NAMES.filter((n) => PERMISSION_META[n].group === group);
      return <div class="srv-perm-group" key={group}>
        <div class="srv-perm-group-head">{group}</div>
        <div class="srv-perm-grid">
          {names.map((name) => {
            const meta = PERMISSION_META[name];
            const on = has(props.permissions, Perm[name]);
            return <label class={`srv-perm ${on ? 'on' : ''}`} key={name} title={meta.description}>
              <input type="checkbox" checked={on} disabled={props.disabled} onChange={() => toggle(name)} />
              <span class="srv-perm-check"><Icon name="check" size={11} /></span>
              <span class="grow"><span class="srv-perm-name">{meta.label}</span><span class="srv-perm-desc">{meta.description}</span></span>
            </label>;
          })}
        </div>
      </div>;
    })}
  </div>;
}
