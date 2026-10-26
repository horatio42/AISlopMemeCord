import { useEffect, useRef } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import type { ComponentChildren } from 'preact';
import { Icon } from './Icons';
import { store } from '../lib/use-store';
import { useApp } from '../lib/use-store';

export function Modal(props: {
  open: boolean; onClose: () => void; title?: ComponentChildren; children: ComponentChildren; footer?: ComponentChildren;
  wide?: boolean; xwide?: boolean; small?: boolean; class?: string; closeOnBackdrop?: boolean; hideClose?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [props.open, props.onClose]);
  if (!props.open) return null;
  return createPortal(
    <div class="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && props.closeOnBackdrop !== false) props.onClose(); }}>
      <div ref={ref} class={`modal ${props.wide ? 'wide' : ''} ${props.xwide ? 'xwide' : ''} ${props.small ? 'small' : ''} ${props.class ?? ''}`} role="dialog" aria-modal="true">
        {props.title !== undefined || !props.hideClose ? (
          <div class="modal-header">
            {props.title ? <h2>{props.title}</h2> : <div class="grow" />}
            {!props.hideClose ? <button class="btn-icon sm" onClick={props.onClose} aria-label="Close"><Icon name="close" size={18} /></button> : null}
          </div>
        ) : null}
        {props.children}
        {props.footer ? <div class="modal-footer">{props.footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export function MenuRoot() {
  const state = useApp();
  const menu = state.menu;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) store.closeMenu(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') store.closeMenu(); };
    setTimeout(() => document.addEventListener('pointerdown', close), 0);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', store.closeMenu);
    window.addEventListener('scroll', store.closeMenu, true);
    return () => {
      document.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', store.closeMenu);
      window.removeEventListener('scroll', store.closeMenu, true);
    };
  }, [menu]);
  if (!menu) return null;
  const width = 220;
  const approxHeight = menu.items.length * 34 + (menu.header ? 26 : 0);
  const left = Math.min(menu.x, window.innerWidth - width - 12);
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - approxHeight - 12));
  return createPortal(
    <div ref={ref} class="menu" style={{ left: `${left}px`, top: `${top}px`, width: `${width}px` }} role="menu">
      {menu.header ? <div class="menu-header">{menu.header}</div> : null}
      {menu.items.map((item, i) => item.header ? <div class="menu-header" key={i}>{item.label}</div> : item.separator ? <div class="menu-sep" key={i} /> : (
        <button key={i} class={`menu-item ${item.danger ? 'danger' : ''}`} disabled={item.disabled} role="menuitem" onClick={() => { store.closeMenu(); item.action?.(); }}>
          {item.icon ? <Icon name={item.icon} size={15} /> : null}
          <span class="grow truncate">{item.label}</span>
          {item.shortcut ? <span class="shortcut">{item.shortcut}</span> : null}
        </button>
      ))}
    </div>,
    document.body,
  );
}

export function Toasts() {
  const state = useApp();
  return createPortal(
    <div class="toasts" aria-live="polite">
      {state.toasts.map((t) => (
        <div key={t.id} class={`toast ${t.kind}`}>
          {t.emoji ? <span style={{ fontSize: 18 }}>{t.emoji}</span> : null}
          <span class="grow">{t.message}</span>
          <button class="toast-close" onClick={() => store.dismissToast(t.id)} aria-label="Dismiss"><Icon name="close" size={14} /></button>
        </div>
      ))}
    </div>,
    document.body,
  );
}

export function Spinner({ size = 20 }: { size?: number }) {
  return <span class="spinner" style={{ width: size, height: size }} />;
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label class="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
      <span class="track" />
      {label ? <span>{label}</span> : null}
    </label>
  );
}

export function Field(props: { label?: string; hint?: string; error?: string; children: ComponentChildren }) {
  return <div class="field">
    {props.label ? <label>{props.label}</label> : null}
    {props.children}
    {props.error ? <span class="error">{props.error}</span> : props.hint ? <span class="hint">{props.hint}</span> : null}
  </div>;
}

export function ConfirmInline({ text, confirmLabel = 'Confirm', onConfirm, danger }: { text: string; confirmLabel?: string; onConfirm: () => void; danger?: boolean }) {
  return <div class="card flat" style={{ padding: 14 }}>
    <p class="muted mb-8" style={{ fontSize: 13 }}>{text}</p>
    <button class={`btn btn-sm ${danger ? 'btn-danger' : ''}`} onClick={onConfirm}>{confirmLabel}</button>
  </div>;
}

export function ErrorBanner({ message }: { message?: string | null }) {
  if (!message) return null;
  return <div class="auth-error" style={{ marginBottom: 12 }}>{message}</div>;
}

export function KbdKey({ children }: { children: ComponentChildren }) { return <span class="kbd">{children}</span>; }
