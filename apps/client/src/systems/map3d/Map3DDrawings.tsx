import { useMemo } from 'react';
import { Line } from '@react-three/drei';
import type { DrawItem, TextItem } from '@/systems/scene/types';

function DrawingRibbon({ item }: { item: DrawItem }) {
  const y = 1.5;
  const points = useMemo(() => {
    const pts: [number, number, number][] = [];
    for (let i = 0; i + 1 < item.points.length; i += 2) {
      const px = item.points[i] ?? 0;
      const py = item.points[i + 1] ?? 0;
      pts.push([item.x + px, y, item.y + py]);
    }
    return pts;
  }, [item, y]);

  if (points.length < 2) return null;

  return <Line points={points} color={item.color} lineWidth={Math.max(1, item.stroke)} />;
}

function TextLabel3D({ item }: { item: TextItem }) {
  return null;
}

export function Map3DDrawings({ drawings, labels }: { drawings: DrawItem[]; labels: TextItem[] }) {
  return (
    <group>
      {drawings.map((d) => (
        <DrawingRibbon key={d.id} item={d} />
      ))}
      {labels.map((t) => (
        <TextLabel3D key={t.id} item={t} />
      ))}
    </group>
  );
}
