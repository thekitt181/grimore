# Grimoire VTT — Project Specification

Authoritative design document for Grimoire VTT. Implementation should follow these sections unless explicitly superseded.

---

## Token System

#### TOKEN SYSTEM — 2D AND 3D TOKENS COEXISTING ON THE SAME MAP

CRITICAL RULE: Both 2D and 3D tokens exist simultaneously on the same map.
They share the same grid, same movement system, same properties panel,
same Socket.io sync. The only difference is how they look.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THE TWO TOKEN TYPES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TYPE A — 2D TOKEN (PixiJS rendered)
- Flat circle shape, exactly like Roll20
- Character/monster image fills the circle
- Coloured ring border around the circle edge
  (colour = player colour or red for enemy)
- Floating name label above
- Floating HP bar above the name
- Lives on the PixiJS canvas layer
- Always visible in both 2D map view and 3D map view
- In 3D view: sits flat on the map surface like a physical token on a table

TYPE B — 3D TOKEN (React Three Fiber rendered)
- Three.js cylinder base (like a real miniature base)
- Character image mapped onto the top face
- Subtle rim glow around base edge
- Floating name label above
- Floating HP bar above name
- Lives in the Three.js scene layer
- Always visible in both 2D map view and 3D map view
- In 2D view: camera is top-down so it looks like a circle from above

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RENDERER ARCHITECTURE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The canvas has two layers stacked on top of each other:

LAYER 1 (bottom): PixiJS canvas
- Renders: map image, grid, fog of war, 2D tokens, wall lines

LAYER 2 (top): Three.js canvas with transparent background
- Renders: 3D tokens only
- Background is fully transparent so PixiJS layer shows through
- Both layers are always active simultaneously
- Both layers share the same camera position and zoom level
  so 2D and 3D tokens appear on the same grid in the same place

Camera sync rules:
- When GM pans the 2D view, the Three.js camera pans identically
- When GM zooms, both cameras zoom identically
- In 3D map mode, PixiJS camera also follows the Three.js orbit camera
- This keeps 2D and 3D tokens always aligned on the grid

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PLACING A TOKEN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
When dragging any image onto the map the category wheel appears (as defined
in Map System section). If the category chosen is Character or Monster:

A second mini popup appears asking:
[ Place as 2D Token ] [ Place as 3D Token ]

This choice is saved per token and can be changed later in properties panel.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SELECTING A TOKEN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Works identically for both token types in both map views
- Click any token to select it (PixiJS hit detection for 2D tokens,
  Three.js raycasting for 3D tokens)
- Selected token shows gold glowing ring around it
- Properties panel opens on right side of screen
- Click empty space to deselect

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MOVING A TOKEN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Identical for both token types
- Select token → click Move button in properties panel
- Token glows blue in move mode
- Click any grid cell to move token there
- Token snaps to grid centre
- Click Move button again to exit move mode
- Position stored as grid coordinates (column, row) never pixels
- Syncs to all players via Socket.io instantly

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TOKEN PROPERTIES PANEL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Same panel for both token types. Right side of screen. Contains:

- Token image (click to replace)
- Name (editable text field)
- Token Type toggle: [ 2D ] [ 3D ] — switches type live on the map
- Current HP / Max HP (number fields)
- HP bar colour (auto: green → yellow → red by percentage)
- Conditions (add/remove from dropdown)
- Move button (toggles move mode on/off)
- Rotate buttons: [ ↺ 45° ] [ ↻ 45° ] (on-screen buttons only, no keyboard)
- Border/Rim colour picker (player colour indicator)
- Hide from players toggle
- Delete button with confirmation popup

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CAMERA CONTROLS — ON SCREEN BUTTONS ONLY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
No keyboard shortcuts. All on-screen buttons top right of canvas.

2D Map Mode:
[ Zoom In ] [ Zoom Out ] [ Reset View ]

3D Map Mode:
[ Zoom In ] [ Zoom Out ] [ Rotate Left ] [ Rotate Right ]
[ Tilt Up ] [ Tilt Down ] [ Reset View ]

Mouse also works:
- Scroll wheel = zoom (both modes)
- Middle mouse drag = pan (both modes)
- Left click drag = orbit (3D mode only)
- Right click drag = pan (3D mode only)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SHARED TOKEN STATE (Zustand tokenStore)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Every token regardless of type stores:
```
{
  id: string
  name: string
  image: string (URL)
  type: '2d' | '3d'
  gridCol: number
  gridRow: number
  rotation: number (degrees)
  hp: number
  maxHp: number
  conditions: string[]
  borderColour: string
  hidden: boolean
  ownerId: string
}
```

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SOCKET.IO EVENTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
token:place    — new token added to map
token:move     — grid position update
token:hp       — HP change
token:type     — switched between 2D and 3D
token:rotate   — rotation update
token:hide     — visibility toggle
token:delete   — removal
token:condition — condition added or removed

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TECHNICAL RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Never store pixel positions — grid coordinates only
- PixiJS and Three.js cameras must stay in sync at all times
- 2D tokens rendered by PixiJS, 3D tokens rendered by React Three Fiber
- Both renderers share the same Zustand tokenStore
- Hit detection: PixiJS handles clicks on 2D tokens,
  Three.js raycasting handles clicks on 3D tokens
- If a click hits both a 2D and 3D token in the same cell,
  prioritise whichever is on top visually

### Cursor Composer prompt (Token System)

Read the TOKEN SYSTEM section of PROJECT.md very carefully. Build exactly what is described. Two token types — 2D flat circle tokens rendered by PixiJS and 3D cylinder miniature tokens rendered by React Three Fiber — both visible simultaneously on the same map. Stack PixiJS and Three.js as two canvas layers with transparent background on Three.js so both show through. Sync both cameras at all times. Build in this exact order and tell me when each step is done before moving on: 1) Zustand tokenStore with the exact schema defined, 2) PixiJS 2D token renderer, 3) Three.js 3D token renderer, 4) Camera sync between both layers, 5) Click selection for both types, 6) Move mode system, 7) Properties panel, 8) Socket.io sync for all token events.
