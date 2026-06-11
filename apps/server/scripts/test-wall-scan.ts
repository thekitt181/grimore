import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';
import { scanMapImageFromPixelData } from '../../client/src/systems/map3d/mapImageSceneScan.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(__dirname, '../../../scripts/fixtures/dungeon-map-1000x826.png');

const WIDTH = 1000;
const HEIGHT = 826;
const GRID = 38;

const mapBase = {
  width: WIDTH,
  height: HEIGHT,
  gridSize: GRID,
  x: 0,
  y: 0,
};

async function loadPixels() {
  const { data, info } = await sharp(fixture).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), w: info.width, h: info.height };
}

function score(result: ReturnType<typeof scanMapImageFromPixelData>): number {
  const walls = result.wallSegments.length;
  const doors = result.doors.length;
  const wallScore = walls >= 35 && walls <= 120 ? 1 : 1 - Math.abs(walls - 70) / 70;
  const doorScore = doors >= 8 && doors <= 40 ? 1 : 1 - Math.abs(doors - 18) / 18;
  return wallScore * 0.55 + doorScore * 0.45;
}

async function main() {
  const { data, w, h } = await loadPixels();
  console.log(`Fixture: ${w}x${h}, grid ${GRID}px`);

  let best = { score: -1, ox: 0, oy: 0, walls: 0, doors: 0, threshold: 70 };

  for (let oy = 0; oy < GRID; oy += 2) {
    for (let ox = 0; ox < GRID; ox += 2) {
      for (const threshold of [64, 68, 70, 72, 76]) {
        const result = scanMapImageFromPixelData(
          { ...mapBase, gridOffsetX: ox, gridOffsetY: oy },
          data,
          w,
          h,
          { threshold, darkRatio: 0.52, darkPixelLum: 58 },
        );
        const s = score(result);
        if (s > best.score) {
          best = { score: s, ox, oy, walls: result.wallSegments.length, doors: result.doors.length, threshold };
        }
      }
    }
  }

  console.log('\nBest alignment:');
  console.log(`  gridOffsetX=${best.ox}, gridOffsetY=${best.oy}, threshold=${best.threshold}`);
  console.log(`  walls=${best.walls}, doors=${best.doors}, score=${best.score.toFixed(3)}`);

  const final = scanMapImageFromPixelData(
    { ...mapBase, gridOffsetX: 0, gridOffsetY: 0 },
    data,
    w,
    h,
    { threshold: 64, darkRatio: 0.52, darkPixelLum: 58 },
  );
  console.log(`  wallCells=${final.wallCellCount}, cols=${final.cols}, rows=${final.rows}`);

  for (const threshold of [60, 64, 68, 70, 72]) {
    const r = scanMapImageFromPixelData({ ...mapBase, gridOffsetX: 0, gridOffsetY: 0 }, data, w, h, { threshold });
    console.log(`  t=${threshold}: walls=${r.wallSegments.length}, doors=${r.doors.length}, wallCells=${r.wallCellCount}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
