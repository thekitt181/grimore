let io = null;
export function setCompendiumSocketServer(server) {
    io = server;
}
export function broadcastCompendiumUpdated(lastUpdated) {
    io?.emit('compendium:updated', { lastUpdated });
}
//# sourceMappingURL=compendiumBroadcast.js.map