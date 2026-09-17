import { GhostButton } from '../atoms/ghostButton.js';
import { h } from '../dom.js';
import { EditConflictNotice } from './editConflictNotice.js';
import { SectionHead } from './sectionHead.js';

export default { title: 'Molecules' };

export const SectionHeads = {
  name: 'Section head',
  render: () =>
    h('div', { style: 'display:flex;flex-direction:column;gap:18px;max-width:560px;' }, [
      SectionHead({ label: 'Description' }),
      SectionHead({ label: 'Description', actions: [GhostButton({ label: 'Edit' })] }),
      SectionHead({
        label: 'Description',
        actions: [GhostButton({ label: 'HEAD → working tree' }), GhostButton({ label: 'Edit' })],
      }),
    ]),
};

export const EditConflict = {
  name: 'Edit conflict notice',
  render: () => h('div', { style: 'max-width:560px;' }, EditConflictNotice({})),
};
