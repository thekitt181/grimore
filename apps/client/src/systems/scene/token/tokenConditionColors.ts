/** Standard D&D 5e condition colours — shared by Pixi and Three.js token renderers. */
export const TOKEN_CONDITION_COLORS: Record<string, string> = {
  Blinded: '#aaaaaa',
  Charmed: '#ff69b4',
  Deafened: '#888888',
  Exhaustion: '#8b4513',
  Frightened: '#9400d3',
  Grappled: '#d2691e',
  Incapacitated: '#ff0000',
  Invisible: '#c0c0c0',
  Paralyzed: '#ffff00',
  Petrified: '#808080',
  Poisoned: '#32cd32',
  Prone: '#a0522d',
  Restrained: '#ffa500',
  Stunned: '#00bfff',
  Unconscious: '#000080',
};

export function tokenConditionColor(name: string): string {
  return TOKEN_CONDITION_COLORS[name] ?? '#ffffff';
}
