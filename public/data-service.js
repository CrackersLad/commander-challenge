import { db } from './firebase-setup.js?v=11.0';
import { ref, get } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";

let localArchives = null;
const ARCHIVES_CACHE_KEY = 'mtg_global_archives_cache_v1';
const ARCHIVES_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function openArchivesIdb() {
    return new Promise((resolve) => {
        if (typeof indexedDB === 'undefined') return resolve(null);
        try {
            const req = indexedDB.open('MTGCommandCenterCache', 1);
            req.onupgradeneeded = (e) => {
                const idb = e.target.result;
                if (!idb.objectStoreNames.contains('archives')) {
                    idb.createObjectStore('archives', { keyPath: 'key' });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
        } catch (e) {
            resolve(null);
        }
    });
}

async function loadCachedArchives() {
    try {
        const idb = await openArchivesIdb();
        if (idb) {
            const cached = await new Promise((resolve) => {
                try {
                    const tx = idb.transaction('archives', 'readonly');
                    const req = tx.objectStore('archives').get(ARCHIVES_CACHE_KEY);
                    req.onsuccess = () => resolve(req.result || null);
                    req.onerror = () => resolve(null);
                } catch (e) {
                    resolve(null);
                }
            });
            if (cached && Array.isArray(cached.cards) && cached.cards.length > 0 && (Date.now() - (cached.timestamp || 0) < ARCHIVES_TTL_MS)) {
                return cached.cards;
            }
        }
    } catch (e) {}
    return null;
}

async function saveCachedArchives(cards) {
    try {
        const idb = await openArchivesIdb();
        if (idb) {
            const tx = idb.transaction('archives', 'readwrite');
            tx.objectStore('archives').put({
                key: ARCHIVES_CACHE_KEY,
                timestamp: Date.now(),
                cards
            });
        }
    } catch (e) {}
}

export async function getArchives() {
    if (localArchives) return localArchives;

    const cached = await loadCachedArchives();
    if (cached && cached.length > 0) {
        localArchives = cached;
        return localArchives;
    }

    const snap = await get(ref(db, 'global_archives/cards'));
    if (snap.exists()) {
        let rawData = snap.val();
        localArchives = Array.isArray(rawData) ? rawData : Object.values(rawData);
        localArchives = localArchives.filter(card => card !== null && card !== undefined);
        saveCachedArchives(localArchives);
        return localArchives;
    }
    return null;
}
