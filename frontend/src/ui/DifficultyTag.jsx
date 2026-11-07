import { difficultyLabel } from '../api/localGame.js';

export const DifficultyTag = ({ code }) => <span className={`diff-tag diff-${code}`}>{difficultyLabel(code)}</span>;
