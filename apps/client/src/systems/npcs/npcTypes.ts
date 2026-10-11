export interface NpcPortrait {
  id: string;
  title: string;
  thumbUrl: string;
  imageUrl: string;
  pageUrl: string;
  source: string;
  creator: string;
  license: string;
}

export interface NpcEntry {
  id: string;
  name: string;
  role: string;
  ancestry: string;
  tags: string[];
  appearance: string;
  personality: string;
  voice: string;
  hook: string;
  secret: string;
  ac: number;
  hp: number;
  attack: string;
  custom?: boolean;
  /** Search text this person was made from, when they came from the codex search. */
  prompt?: string;
}

export interface NpcRecord extends NpcEntry {
  portrait?: NpcPortrait;
}
