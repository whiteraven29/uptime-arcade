import { ViEditor } from '../../../../ui/ViEditor.jsx';
import { VI, viPress, viSelection } from '../../../../api/game.js';

export const ViWorkspace = () => <ViEditor vi={VI} onKey={viPress} selection={viSelection} />;
