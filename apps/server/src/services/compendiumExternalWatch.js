import { invalidateExtensionGlobalCache, fetchExtensionGlobalDoc, fetchExtensionVersion, } from './compendiumExtensionBridge';
import { clearGlobalFallbackCache, globalFallbackFileRevision, } from './compendiumGlobalFallback';
import { readMongoGlobalDoc, newestIso, isoTimestamp } from './compendiumGlobal';
import { notifyCompendiumChanged } from './compendiumChangeNotify';
const POLL_MS = 2_000;
let lastSeen = '';
let started = false;
/** Backup poll for extension HTTP + data.json when change stream is unavailable. */
export function startCompendiumExternalWatch() {
    if (started)
        return;
    started = true;
    const tick = async () => {
        try {
            const stamps = [];
            const mongo = await readMongoGlobalDoc();
            if (mongo?.lastUpdated)
                stamps.push(isoTimestamp(mongo.lastUpdated));
            const extVersion = await fetchExtensionVersion();
            if (extVersion)
                stamps.push(extVersion);
            const fileRev = globalFallbackFileRevision();
            if (fileRev)
                stamps.push(fileRev);
            const latest = stamps.length ? newestIso(...stamps) : '';
            if (!latest)
                return;
            if (lastSeen && latest !== lastSeen) {
                invalidateExtensionGlobalCache();
                clearGlobalFallbackCache();
                await fetchExtensionGlobalDoc(true);
                notifyCompendiumChanged(latest);
                console.log('[Compendium] External change detected (poll backup), notifying clients');
            }
            lastSeen = latest;
        }
        catch (err) {
            console.error('[Compendium] External watch error:', err);
        }
    };
    void tick();
    setInterval(() => void tick(), POLL_MS);
}
//# sourceMappingURL=compendiumExternalWatch.js.map