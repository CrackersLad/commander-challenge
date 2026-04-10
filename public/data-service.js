import { db } from './firebase-setup.js?v=19.24';
import { ref, get } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";

let localArchives = null;

export async function getArchives() {
    if (localArchives) return localArchives;
    const snap = await get(ref(db, 'global_archives/cards'));
    if (snap.exists()) {
        let rawData = snap.val();
        localArchives = Array.isArray(rawData) ? rawData : Object.values(rawData);
        localArchives = localArchives.filter(card => card !== null && card !== undefined);
        return localArchives;
    }
    return null;
}