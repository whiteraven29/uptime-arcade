import { difficultyLabel } from '../api/game.js';

export const DifficultyTag = ({ code }) => <span className={`diff-tag diff-${code}`}>{difficultyLabel(code)}</span>;
