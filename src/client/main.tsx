import { render } from 'preact';
import { AuthView } from './views/AuthView';
import { ChatApp } from './views/ChatApp';
import { InviteView } from './views/InviteView';
import { store, useApp } from './lib/use-store';
import { currentPath } from './lib/store';

function Root() {
  const state = useApp();
  if (!state.authReady) return <AuthView />;
  if (!state.user) return <AuthView />;
  if (state.view.type === 'invite') return <InviteView />;
  return <ChatApp />;
}

render(<Root />, document.getElementById('app-root')!);
store.init();
window.addEventListener('popstate', () => { void store.applyRoute(currentPath(), false); });
