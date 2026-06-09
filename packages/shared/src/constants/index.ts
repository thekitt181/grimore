export const SOCKET_EVENTS = {
  // Map
  MAP_TOKEN_MOVE: 'map:tokenMove',
  MAP_FOG_UPDATE: 'map:fogUpdate',
  FOG_SYNC: 'fog:sync',
  // Combat
  COMBAT_INITIATIVE: 'combat:initiative',
  COMBAT_HP_UPDATE: 'combat:hpUpdate',
  // Dice
  DICE_ROLL: 'dice:roll',
  // Scene
  SCENE_CHANGE: 'scene:change',
  // Handout
  HANDOUT_REVEAL: 'handout:reveal',
  // Chat
  CHAT_MESSAGE: 'chat:message',
  // Session
  SESSION_JOIN: 'session:join',
  SESSION_LEAVE: 'session:leave',
  SESSION_USER_JOINED: 'session:userJoined',
  SESSION_USER_LEFT: 'session:userLeft',
  SESSION_ROOM_STATE: 'session:roomState',
} as const;

export const D5E_CONDITIONS = [
  'Blinded',
  'Charmed',
  'Deafened',
  'Exhaustion',
  'Frightened',
  'Grappled',
  'Incapacitated',
  'Invisible',
  'Paralyzed',
  'Petrified',
  'Poisoned',
  'Prone',
  'Restrained',
  'Stunned',
  'Unconscious',
] as const;

export type D5ECondition = (typeof D5E_CONDITIONS)[number];

export const DICE_TYPES = [4, 6, 8, 10, 12, 20, 100] as const;
export type DieType = (typeof DICE_TYPES)[number];

export const ABILITY_SCORES = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
] as const;
export type AbilityScore = (typeof ABILITY_SCORES)[number];

export const INVITE_CODE_LENGTH = 8;
