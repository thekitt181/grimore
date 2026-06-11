import { buildSceneFromWalkableGrid } from '@grimoire/shared';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(__dirname, '../../../scripts/fixtures/dungeon-map-1000x826.png');
const REPO_ROOT = path.join(__dirname, '../../..');

const map = {
  width: 1000,
  height: 826,
  gridSize: 38,
  gridOffsetX: 0,
  gridOffsetY: 0,
  x: 0,
  y: 0,
};

async function main() {
  const imageBase64 = fs.readFileSync(fixture).toString('base64');
  const payload = JSON.stringify({ ...map, imageBase64 });

  const result = await new Promise<string>((resolve, reject) => {
    const child = spawn('python', ['-m', 'floorplan_scan.cli'], {
      cwd: path.join(REPO_ROOT, 'services', 'floorplan-scan'),
      env: {
        ...process.env,
        PYTHONPATH: [
          path.join(REPO_ROOT, 'services', 'floorplan-scan', 'src'),
          path.join(REPO_ROOT, 'services', 'floorplan-to-3d-ref', 'src'),
        ].join(path.delimiter),
        FLOORPLAN_WEIGHTS_DIR: path.join(REPO_ROOT, 'services', 'floorplan-scan', 'weights'),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(stderr || stdout));
      else resolve(stdout);
    });
    child.stdin.write(payload);
    child.stdin.end();
  });

  const grid = JSON.parse(result);
  console.log('Python scan:', { cols: grid.cols, rows: grid.rows, method: grid.method, device: grid.device });
  const scene = buildSceneFromWalkableGrid(map, grid.cols, grid.rows, grid.walkable);
  console.log(`Walls: ${scene.wallSegments.length}, doors: ${scene.doors.length}, features: ${scene.featureCount}, wallCells: ${scene.wallCellCount}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
