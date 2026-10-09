// the "open in" buttons of the apps open the other app in a new tab and tell this
// server about it too, so a tab of the other app that is connected already follows

import type { AppName } from './protocol.js';
import type { Bridge } from './server.js';

interface Switch {
  to?: string;
  project?: string;
  notebook?: string;
}

export function followSwitches(bridge: Bridge, log: (message: string) => void = () => {}): void {
  bridge.on('event', (app: AppName, name: string, data: unknown) => {
    if (name !== 'switch' || !data || typeof data !== 'object') return;
    const { to, project, notebook } = data as Switch;
    if (app === 'brainotes' && to === 'tex' && project && bridge.connected('texbrain')) {
      bridge.call('texbrain', 'open', { name: project }).catch((error) => log(`TeXbrain could not open ${project}: ${String(error)}`));
    }
    if (app === 'texbrain' && to === 'notes' && notebook && bridge.connected('brainotes')) {
      bridge.call('brainotes', 'open', { id: notebook }).catch((error) => log(`braiNOTES could not open ${notebook}: ${String(error)}`));
    }
  });
}
