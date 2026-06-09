import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import { compendiumImageKey, compendiumStaticImagePath, owlbearStaticImagePath, toOwlbearMongoImageRef } from '@grimoire/monster-dex';
import { globalDoc, readMongoGlobalDoc, isoTimestamp } from './compendiumGlobal';
import { saveOwlbearImageFields } from './compendiumOwlbearPersist';
const MAX_HISTORY = 20;
function owlbearPublicRoots() {
    const roots = [];
    const dataDir = process.env['OWLBear_DATA_DIR'];
    if (dataDir) {
        const base = path.dirname(dataDir);
        roots.push(path.join(base, 'public'));
        roots.push(path.join(base, 'dist'));
    }
    roots.push(path.resolve(process.cwd(), '../../../owlbear_dnd_extension/public'));
    roots.push(path.resolve(process.cwd(), '../../../owlbear_dnd_extension/dist'));
    return [...new Set(roots)];
}
function assetApiPath(relativePath) {
    const clean = relativePath.replace(/^\/+/, '');
    return `/api/compendium/asset/${clean.split('/').map(encodeURIComponent).join('/')}`;
}
function extractStaticKey(url) {
    const match = url.match(/[?&]key=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : null;
}
function hasStoredImageBlob(global, key) {
    const data = global.imagesData?.[key];
    return Boolean(data?.startsWith('data:image'));
}
function mappedImagePath(global, key) {
    const mapped = global.images?.[key];
    if (!mapped || mapped.includes('static-image'))
        return null;
    return mapped;
}
function resolveMappedPath(mapped) {
    if (mapped.startsWith('/api/compendium/asset/'))
        return mapped;
    if (mapped.startsWith('/images/') || mapped.startsWith('images/')) {
        return assetApiPath(mapped.replace(/^\/+/, ''));
    }
    if (/^https?:\/\//.test(mapped))
        return mapped;
    return mapped;
}
function isResolvableImageRef(global, url) {
    if (url.startsWith('data:image'))
        return true;
    if (/^https?:\/\//.test(url))
        return true;
    if (url.startsWith('/api/compendium/asset/'))
        return true;
    if (url.startsWith('/images/') || url.startsWith('images/'))
        return true;
    if (url.includes('static-image')) {
        const key = extractStaticKey(url);
        if (!key)
            return false;
        if (hasStoredImageBlob(global, key))
            return true;
        const mapped = mappedImagePath(global, key);
        if (mapped?.startsWith('/api/compendium/asset/'))
            return true;
        if (mapped?.startsWith('/images/') || mapped?.startsWith('images/'))
            return true;
        if (mapped && /^https?:\/\//.test(mapped))
            return true;
        return false;
    }
    return true;
}
function normalizeStoredUrl(url) {
    if (url.startsWith('data:image'))
        return url;
    if (url.includes('/api/static-image') || url.includes('/api/compendium/static-image')) {
        const key = extractStaticKey(url);
        if (key)
            return compendiumStaticImagePath(key);
    }
    return url;
}
function addHistory(history, url) {
    const normalized = normalizeStoredUrl(url);
    const next = [normalized, ...history.filter((u) => u !== normalized)];
    return next.slice(0, MAX_HISTORY);
}
export function resolveEntryImageUrl(global, kind, name, entryImage) {
    const key = compendiumImageKey(kind, name);
    const images = global.images ?? {};
    const imagesData = global.imagesData ?? {};
    const custom = images[key];
    if (custom) {
        if (custom.startsWith('data:image'))
            return compendiumStaticImagePath(key);
        if (/^https?:\/\//.test(custom))
            return custom;
        if (custom.includes('static-image')) {
            const staticKey = extractStaticKey(custom);
            return staticKey ? compendiumStaticImagePath(staticKey) : compendiumStaticImagePath(key);
        }
        if (custom.startsWith('/api/compendium/asset/'))
            return custom;
        if (custom.startsWith('/images/') || custom.startsWith('images/')) {
            const rel = custom.replace(/^\/+/, '');
            return assetApiPath(rel);
        }
    }
    if (imagesData[key])
        return compendiumStaticImagePath(key);
    if (entryImage) {
        if (entryImage.startsWith('data:image'))
            return entryImage;
        if (/^https?:\/\//.test(entryImage))
            return entryImage;
        if (entryImage.includes('static-image')) {
            const staticKey = extractStaticKey(entryImage);
            return staticKey ? compendiumStaticImagePath(staticKey) : undefined;
        }
        const rel = entryImage.replace(/^\/+/, '');
        return assetApiPath(rel);
    }
    return undefined;
}
export function resolveHistoryUrl(global, url) {
    if (url.startsWith('data:image')) {
        return url;
    }
    if (/^https?:\/\//.test(url))
        return url;
    if (url.includes('static-image')) {
        const key = extractStaticKey(url);
        if (key) {
            if (hasStoredImageBlob(global, key))
                return compendiumStaticImagePath(key);
            const mapped = mappedImagePath(global, key);
            if (mapped)
                return resolveMappedPath(mapped);
        }
        return normalizeStoredUrl(url);
    }
    if (url.startsWith('/api/compendium/asset/'))
        return url;
    if (url.startsWith('/images/') || url.startsWith('images/')) {
        return assetApiPath(url.replace(/^\/+/, ''));
    }
    return url;
}
export async function getGlobalDocForImages() {
    const mongo = await readMongoGlobalDoc({ includeImageData: true });
    if (mongo)
        return mongo;
    return globalDoc({ includeImageData: true });
}
export async function getEntryImageState(kind, name, entryImage) {
    const global = await globalDoc();
    const key = compendiumImageKey(kind, name);
    const current = resolveEntryImageUrl(global, kind, name, entryImage) ?? null;
    const rawHistory = global.entryImages?.[name] ?? [];
    const history = rawHistory
        .map((u) => resolveHistoryUrl(global, u))
        .filter((u) => isResolvableImageRef(global, u));
    if (current && !history.includes(current)) {
        history.unshift(current);
    }
    return {
        key,
        current,
        history: history.slice(0, MAX_HISTORY),
        updatedAt: isoTimestamp(global.lastUpdated),
    };
}
export async function saveEntryImage(kind, name, imageUrl, entryImage) {
    const doc = await globalDoc();
    const images = { ...(doc.images ?? {}) };
    const imagesData = { ...(doc.imagesData ?? {}) };
    const entryImages = { ...(doc.entryImages ?? {}) };
    const key = compendiumImageKey(kind, name);
    let history = entryImages[name] ?? [];
    if (!imageUrl) {
        delete images[key];
        delete imagesData[key];
    }
    else if (imageUrl.startsWith('data:image')) {
        const previousData = imagesData[key];
        if (previousData?.startsWith('data:image')) {
            history = addHistory(history, previousData);
        }
        imagesData[key] = imageUrl;
        images[key] = owlbearStaticImagePath(key);
    }
    else if (imageUrl.includes('static-image')) {
        const staticKey = extractStaticKey(imageUrl);
        if (staticKey && imagesData[staticKey]) {
            images[key] = owlbearStaticImagePath(key);
            if (staticKey !== key) {
                imagesData[key] = imagesData[staticKey];
            }
        }
        else if (staticKey) {
            const mapped = images[staticKey] ?? doc.images?.[staticKey];
            if (mapped && !mapped.includes('static-image')) {
                images[key] = toOwlbearMongoImageRef(mapped.startsWith('/api/compendium/asset/')
                    ? mapped
                    : mapped.startsWith('/images/') || mapped.startsWith('images/')
                        ? mapped
                        : mapped);
                delete imagesData[key];
            }
            else {
                throw new Error('That image is no longer in storage. Upload again or pick another thumbnail.');
            }
        }
        else {
            images[key] = toOwlbearMongoImageRef(normalizeStoredUrl(imageUrl));
        }
    }
    else if (/^https?:\/\//.test(imageUrl)) {
        images[key] = imageUrl;
        delete imagesData[key];
    }
    else if (imageUrl.startsWith('/api/compendium/asset/') || imageUrl.startsWith('images/') || imageUrl.startsWith('/images/')) {
        const rel = imageUrl.startsWith('/api/compendium/asset/')
            ? decodeURIComponent(imageUrl.slice('/api/compendium/asset/'.length))
            : imageUrl.replace(/^\/+/, '');
        images[key] = toOwlbearMongoImageRef(`/${rel}`);
        delete imagesData[key];
    }
    else {
        throw new Error('Invalid image URL');
    }
    if (imageUrl) {
        entryImages[name] = addHistory(history, images[key] ?? imageUrl);
    }
    let nextDoc = {
        images,
        imagesData,
        entryImages,
    };
    const storedEntryImage = imageUrl
        ? toOwlbearMongoImageRef(images[key] ?? imageUrl)
        : entryImage;
    await saveOwlbearImageFields({
        images: nextDoc.images,
        imagesData: nextDoc.imagesData,
        entryImages: nextDoc.entryImages,
    }, {
        kind,
        name,
        image: imageUrl ? storedEntryImage : undefined,
    });
    return getEntryImageState(kind, name, storedEntryImage);
}
export async function serveStaticImage(key, res) {
    const global = await getGlobalDocForImages();
    const pathOrUrl = global.images?.[key] ?? null;
    const rawData = global.imagesData?.[key] ?? null;
    if (pathOrUrl?.startsWith('/api/compendium/asset/')) {
        const rel = decodeURIComponent(pathOrUrl.slice('/api/compendium/asset/'.length));
        serveAssetFile(rel, res);
        return;
    }
    if (pathOrUrl && (pathOrUrl.startsWith('/images/') || pathOrUrl.startsWith('images/'))) {
        const rel = pathOrUrl.replace(/^\/+/, '');
        const served = tryServeAssetFile(rel, res);
        if (served)
            return;
    }
    if (rawData?.startsWith('data:image')) {
        const matches = rawData.match(/^data:image\/([a-zA-Z0-9+\.-]+);base64,(.+)$/);
        if (!matches?.[2]) {
            res.status(400).json({ error: 'Invalid stored image data' });
            return;
        }
        let ext = matches[1];
        if (ext === 'svg+xml')
            ext = 'svg';
        const buffer = Buffer.from(matches[2], 'base64');
        res.setHeader('Content-Type', `image/${ext}`);
        res.setHeader('Cache-Control', 'private, no-cache, must-revalidate');
        res.end(buffer);
        return;
    }
    if (pathOrUrl && /^https?:\/\//.test(pathOrUrl)) {
        await proxyExternalImage(pathOrUrl, res);
        return;
    }
    res.status(404).json({ error: 'Image not found' });
}
function tryServeAssetFile(relativePath, res) {
    for (const root of owlbearPublicRoots()) {
        const filePath = path.join(root, relativePath);
        const normalizedRoot = path.resolve(root);
        const normalizedFile = path.resolve(filePath);
        if (!normalizedFile.startsWith(normalizedRoot))
            continue;
        if (fs.existsSync(normalizedFile)) {
            res.sendFile(normalizedFile);
            return true;
        }
    }
    return false;
}
export function serveAssetFile(relativePath, res) {
    const clean = relativePath.replace(/^(\.\.(\/|\\|$))+/, '').replace(/^\/+/, '');
    if (tryServeAssetFile(clean, res))
        return;
    res.status(404).json({ error: 'Asset not found' });
}
function proxyExternalImage(url, res) {
    return new Promise((resolve) => {
        try {
            const target = new URL(url);
            const protocol = target.protocol === 'https:' ? https : http;
            protocol.get(url, (proxyRes) => {
                res.status(proxyRes.statusCode ?? 502);
                if (proxyRes.headers['content-type']) {
                    res.setHeader('Content-Type', proxyRes.headers['content-type']);
                }
                proxyRes.pipe(res);
                proxyRes.on('end', resolve);
            }).on('error', () => {
                res.status(502).json({ error: 'Failed to proxy image' });
                resolve();
            });
        }
        catch {
            res.status(400).json({ error: 'Invalid URL' });
            resolve();
        }
    });
}
//# sourceMappingURL=compendiumImages.js.map