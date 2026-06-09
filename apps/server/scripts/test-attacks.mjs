import { extractAllAttacks } from '../src/services/ddb/attackExtract.ts';
import { extractAbilities } from '../src/services/ddb/abilitiesExtract.ts';

const abilities = extractAbilities({
  stats: [{ value: 16 }, { value: 14 }, { value: 14 }, { value: 10 }, { value: 10 }, { value: 10 }],
  bonusStats: Array.from({ length: 6 }, () => ({ value: null })),
  overrideStats: Array.from({ length: 6 }, () => ({ value: null })),
  classes: [{ level: 4 }],
  modifiers: {},
});

const raw = {
  classes: [{ level: 4 }],
  proficiencyBonus: 2,
  inventory: [
    {
      id: 1,
      equipped: true,
      definition: {
        name: 'Vicious Spear',
        filterType: 'Weapon',
        type: 'Spear',
        categoryId: 1,
        attackType: 1,
        damage: { diceString: '1d6' },
        damageType: 'Piercing',
        range: 20,
        longRange: 60,
        properties: [
          { name: 'Thrown' },
          { name: 'Versatile', notes: '1d8' },
        ],
        weaponBehaviors: [],
      },
    },
    {
      id: 2,
      equipped: true,
      definition: {
        name: 'Returning Trident',
        filterType: 'Weapon',
        type: 'Trident',
        categoryId: 1,
        attackType: 1,
        damage: { diceString: '1d8' },
        damageType: 'Piercing',
        range: 20,
        longRange: 60,
        properties: [{ name: 'Thrown' }, { name: 'Versatile', notes: '1d10' }],
        weaponBehaviors: [],
      },
    },
    {
      id: 3,
      equipped: true,
      definition: {
        name: 'Chain Mail',
        filterType: 'Armor',
        type: 'Heavy Armor',
        armorClass: 16,
        weaponBehaviors: [],
      },
    },
  ],
  customActions: [{ name: 'Sap (Spear)', dice: null, attackModifier: 0 }],
  actions: { custom: [], class: [], race: [], feat: [], item: [] },
};

console.log(extractAllAttacks(raw, abilities).map((a) => `${a.name} ${a.damageDice} +${a.toHit} range=${a.range} props=${a.properties?.join(',')}`));

const sparse = {
  ...raw,
  inventory: [
    { id: 9, equipped: true, definition: { name: 'Vicious Spear', type: 'Spear', canEquip: true } },
  ],
  customActions: [],
};
console.log('sparse:', extractAllAttacks(sparse, abilities).map((a) => `${a.name} ${a.damageDice}`));
