import { D5E_CONDITIONS } from './index';

export type D5eConditionRef = {
  name: (typeof D5E_CONDITIONS)[number];
  summary: string;
};

/** PHB-style one-liners for GM quick reference. */
export const D5E_CONDITION_REFERENCE: D5eConditionRef[] = [
  { name: 'Blinded', summary: 'Auto-fail sight checks; attacks against have advantage; your attacks have disadvantage.' },
  { name: 'Charmed', summary: 'Cannot attack the charmer; charmer has advantage on social checks against you.' },
  { name: 'Deafened', summary: 'Auto-fail hearing checks.' },
  { name: 'Exhaustion', summary: 'Level 1–6 with escalating penalties (disadvantage, speed halved, HP max halved, death at 6).' },
  { name: 'Frightened', summary: 'Disadvantage on ability checks and attacks while source is in line of sight; cannot willingly move closer.' },
  { name: 'Grappled', summary: 'Speed becomes 0; ends if grappler is incapacitated or moved away.' },
  { name: 'Incapacitated', summary: 'Cannot take actions or reactions.' },
  { name: 'Invisible', summary: 'Heavily obscured for hiding; attacks against have disadvantage; your attacks have advantage.' },
  { name: 'Paralyzed', summary: 'Incapacitated; auto-fail Str/Dex saves; attacks within 5 ft have advantage and crit on hit.' },
  { name: 'Petrified', summary: 'Turned to stone; incapacitated; resistant to all damage; auto-fail Str/Dex saves.' },
  { name: 'Poisoned', summary: 'Disadvantage on attack rolls and ability checks.' },
  { name: 'Prone', summary: 'Melee attacks against have advantage; ranged have disadvantage; standing costs half speed.' },
  { name: 'Restrained', summary: 'Speed 0; disadvantage on attacks and Dex saves; attacks against have advantage.' },
  { name: 'Stunned', summary: 'Incapacitated; auto-fail Str/Dex saves; attacks against have advantage.' },
  { name: 'Unconscious', summary: 'Incapacitated; drops held items; falls prone; auto-fail Str/Dex saves; hits within 5 ft are crits.' },
];
