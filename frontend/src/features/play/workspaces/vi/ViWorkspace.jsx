import { ViEditor } from '../../../../ui/ViEditor.jsx';
import { VI, viPress } from '../../../../api/localGame.js';

export const ViWorkspace = () => <ViEditor vi={VI} onKey={viPress} />;
