import { useSyncExternalStore } from 'react';
import { getVersion, subscribe } from './game.js';

/** Re-render this component whenever the game changes. */
export const useGame = () => useSyncExternalStore(subscribe, getVersion);
