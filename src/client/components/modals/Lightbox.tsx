import { useEffect } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { store, useApp } from '../../lib/use-store';
import { Icon } from '../Icons';

export function Lightbox() {
  const state = useApp();
  const lb = state.ui.lightbox;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') store.closeLightbox(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  if (!lb) return null;
  const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(lb.url) || lb.url.includes('/video/');
  return createPortal(<div class="lightbox" onMouseDown={(e) => { if (e.target === e.currentTarget) store.closeLightbox(); }}>
    <button class="btn-icon lightbox-close" onClick={() => store.closeLightbox()} aria-label="Close"><Icon name="close" size={20} /></button>
    {isVideo ? <video src={lb.url} controls autoPlay /> : <img src={lb.url} alt={lb.alt ?? ''} />}
    <div class="lightbox-meta"><span>{lb.alt || 'Slop attachment'}</span><a href={lb.url} download style={{ marginLeft: 10 }}><Icon name="download" size={12} /> download</a></div>
  </div>, document.body);
}
