import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

type HingeKind = 'door' | 'lid' | 'lift';

function hingeKind(name: string): HingeKind {
  const n = name.toLowerCase();
  if (n.includes('lid') || n.includes('cover')) return 'lid';
  if (n === 'gate' || n.includes('bars') || n.includes('portcullis')) return 'lift';
  return 'door';
}

function findHinge(root: THREE.Object3D, doorNode?: string): THREE.Object3D | null {
  if (doorNode) {
    const named = root.getObjectByName(doorNode);
    if (named) return named;
  }
  const wanted = ['door', 'Door', 'gate', 'chest_lid', 'chest_gold_lid'];
  for (const w of wanted) {
    const hit = root.getObjectByName(w);
    if (hit && hit !== root) return hit;
  }
  let found: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (found || o === root) return;
    const n = o.name.toLowerCase();
    if (n.includes('door') || n.includes('lid') || n === 'gate') found = o;
  });
  return found;
}

/**
 * Kenney gate-door: play GLB open/close clips.
 * KayKit doorways / chests: hinge the named door or lid mesh.
 * Kenney portcullis: lift the `gate` mesh.
 */
export function ModularPieceAnim({
  root,
  animations,
  open,
  openAt,
  doorNode,
}: {
  root: THREE.Object3D;
  animations: THREE.AnimationClip[];
  open: boolean;
  openAt?: number;
  doorNode?: string;
}) {
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const hingeRef = useRef<THREE.Object3D | null>(null);
  const kindRef = useRef<HingeKind>('door');
  const rest = useRef({ y: 0, rotX: 0, rotY: 0 });
  const amount = useRef(open ? 1 : 0);
  const primed = useRef(false);

  useEffect(() => {
    const hinge = findHinge(root, doorNode);
    hingeRef.current = hinge;
    if (hinge) {
      kindRef.current = hingeKind(hinge.name);
      rest.current = { y: hinge.position.y, rotX: hinge.rotation.x, rotY: hinge.rotation.y };
    }
  }, [root, doorNode]);

  useEffect(() => {
    const openClip = animations.find((c) => /^open$/i.test(c.name));
    const closeClip = animations.find((c) => /^close$/i.test(c.name));
    const idle = animations.filter((c) => !/^open$/i.test(c.name) && !/^close$/i.test(c.name));
    if (!openClip && !closeClip && idle.length > 0) {
      const mixer = new THREE.AnimationMixer(root);
      mixerRef.current = mixer;
      for (const clip of idle) {
        const action = mixer.clipAction(clip);
        action.reset();
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.play();
      }
      return () => {
        mixer.stopAllAction();
        mixerRef.current = null;
      };
    }
    if (!openClip && !closeClip) {
      mixerRef.current?.stopAllAction();
      mixerRef.current = null;
      if (!primed.current) {
        amount.current = open ? 1 : 0;
        primed.current = true;
      }
      return;
    }
    const mixer = new THREE.AnimationMixer(root);
    mixerRef.current = mixer;
    const clip = open ? (openClip ?? closeClip)! : (closeClip ?? openClip)!;
    const action = mixer.clipAction(clip);
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    if (!primed.current) {
      action.time = open && openClip ? clip.duration : (!open && closeClip ? clip.duration : 0);
      action.play();
      mixer.update(0);
      primed.current = true;
    } else {
      action.timeScale = open ? (openClip ? 1 : -1) : (closeClip ? 1 : -1);
      if (open && !openClip && closeClip) action.time = clip.duration;
      if (!open && !closeClip && openClip) action.time = clip.duration;
      action.play();
    }
    return () => {
      mixer.stopAllAction();
      mixerRef.current = null;
    };
  }, [root, animations, open, openAt]);

  useFrame((_, dt) => {
    const mixer = mixerRef.current;
    if (mixer) {
      mixer.update(dt);
      return;
    }
    const hinge = hingeRef.current;
    if (!hinge) return;
    amount.current = THREE.MathUtils.damp(amount.current, open ? 1 : 0, 8, dt);
    const a = amount.current;
    const k = kindRef.current;
    if (k === 'lid') {
      hinge.rotation.x = rest.current.rotX - a * 1.15;
    } else if (k === 'lift') {
      hinge.position.y = rest.current.y + a * 3.2;
    } else {
      hinge.rotation.y = rest.current.rotY + a * (Math.PI / 2);
    }
  });

  return null;
}
