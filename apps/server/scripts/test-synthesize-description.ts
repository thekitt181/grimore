import { synthesizeCompendiumItemDescription } from '@grimoire/shared';

const item = {
  name: '• Superior Elemental Protection Trinket: Absorbs 60',
  type: 'points of elemental damage. (very rare)',
  description: '',
  flavor: '',
  details: '',
};

console.log(synthesizeCompendiumItemDescription(item));
