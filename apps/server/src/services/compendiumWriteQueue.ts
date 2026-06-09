/** Serialize compendium global-doc writes so read-modify-write cannot interleave. */
let chain: Promise<unknown> = Promise.resolve();

export function enqueueCompendiumWrite<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}
