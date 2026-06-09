/** Serialize compendium global-doc writes so read-modify-write cannot interleave. */
let chain = Promise.resolve();
export function enqueueCompendiumWrite(fn) {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
}
//# sourceMappingURL=compendiumWriteQueue.js.map