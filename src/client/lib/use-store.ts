import { useSyncExternalStore } from 'preact/compat';
import { store } from './store';
import type { AppState } from './store-types';

/** Subscribe a component to the app store's external snapshot. */
export function useApp(): AppState {
  useSyncExternalStore(store.subscribe, () => store.version);
  return store.state;
}
export { store };
