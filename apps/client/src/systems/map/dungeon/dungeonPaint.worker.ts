import { paintDungeonBlob, type DungeonPaintJob } from './paintDungeonImage';

interface PaintWorkerScope {
  onmessage: ((event: MessageEvent<DungeonPaintJob>) => void) | null;
  postMessage(message: unknown): void;
}

const scope = self as unknown as PaintWorkerScope;

scope.onmessage = (event) => {
  void paintDungeonBlob(event.data)
    .then((blob) => scope.postMessage({ ok: true, blob }))
    .catch((error: unknown) => scope.postMessage({ ok: false, error: error instanceof Error ? error.message : 'paint failed' }));
};
