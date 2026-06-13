import { synthesizeCompendiumItemDescription } from '@grimoire/shared';

/** Simulates an old journal receipt with empty content and no compendium id. */
const receipt = {
  title: '• Superior Elemental Protection Trinket: Absorbs 60',
  content: '',
  itemMeta: {
    itemType: 'points of elemental damage. (very rare)',
    isCustom: true,
  },
};

const synthesized = synthesizeCompendiumItemDescription({
  name: receipt.title,
  type: receipt.itemMeta.itemType,
  description: receipt.content,
});

console.log('Synthesized from receipt meta:', synthesized);
