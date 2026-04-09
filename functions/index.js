const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onValueUpdated, onValueCreated, onValueDeleted, onValueWritten } = require("firebase-functions/v2/database");
const admin = require("firebase-admin");
const fetch = require("node-fetch");

admin.initializeApp({
    databaseURL: "https://commander-challenge-default-rtdb.europe-west1.firebasedatabase.app"
});

function extractAll(obj, results = []) {
    if (!obj) return results;
    if (obj.cardviews && Array.isArray(obj.cardviews)) results.push(...obj.cardviews);
    if (Array.isArray(obj)) {
        for (let item of obj) extractAll(item, results);
    } else if (typeof obj === 'object') {
        for (let key in obj) {
            if (key !== 'container') extractAll(obj[key], results);
        }
        if (obj.container) extractAll(obj.container, results);
    }
    return results;
}

async function performArchiveSync() {
    try {
        console.log("--- FINAL FIX: PURGING DATA ---");
        await admin.database().ref('global_archives').remove();
        
        let edhrecDataMap = new Map();

        for (let i = 0; i <= 30; i++) {
            let url = i === 0 
                ? "https://json.edhrec.com/pages/commanders/year.json" 
                : `https://json.edhrec.com/pages/commanders/year-past2years-${i}.json`;

            let res = await fetch(url);
            if (!res.ok) res = await fetch(`https://json.edhrec.com/pages/commanders/year-${i}.json`);
            if (!res.ok) break;

            const data = await res.json();
            const rawCards = extractAll(data);
            
            rawCards.forEach(c => {
                if (c.name && c.num_decks) {
                    const deckCount = parseInt(c.num_decks);
                    if (!edhrecDataMap.has(c.name) || edhrecDataMap.get(c.name) < deckCount) {
                        edhrecDataMap.set(c.name, deckCount);
                    }
                }
            });
            await new Promise(r => setTimeout(r, 50));
        }

        const sortedEdhrec = Array.from(edhrecDataMap.entries()).sort((a, b) => b[1] - a[1]);
        let finalRanks = {};
        sortedEdhrec.forEach(([fullName, count], index) => {
            const rank = index + 1;
            finalRanks[fullName] = rank;
            if (fullName.includes(" // ")) {
                fullName.split(" // ").forEach(part => {
                    const p = part.trim();
                    if (!finalRanks[p]) finalRanks[p] = rank;
                });
            }
        });

        let scryCards = [];
        let sUrl = "https://api.scryfall.com/cards/search?q=is:commander+-is:digital";
        let retries = 0;
        
        while (sUrl) {
            const res = await fetch(sUrl);
            if (!res.ok) {
                if (retries < 3) {
                    retries++;
                    console.warn(`Scryfall fetch failed (${res.status}). Retrying in ${retries * 2}s...`);
                    await new Promise(r => setTimeout(r, 2000 * retries));
                    continue;
                }
                throw new Error(`Scryfall API failed after 3 retries: ${res.statusText}`);
            }
            retries = 0;
            const data = await res.json();
            if (data.data) scryCards.push(...data.data);
            sUrl = data.has_more ? data.next_page : null;
            await new Promise(r => setTimeout(r, 100)); // Respect Scryfall's 100ms rate limit
        }

        let finalArray = scryCards.map(c => {
            let img1 = c.image_uris?.normal || (c.card_faces && c.card_faces[0].image_uris?.normal) || "";
            let img2 = (c.card_faces && c.card_faces[1] && c.card_faces[1].image_uris?.normal) || null;
            if (!img1) return null;

            const nameMatch = c.name.includes(" // ") ? c.name.split(" // ")[0] : c.name;
            const rank = finalRanks[c.name] || finalRanks[nameMatch] || 99999;

            return {
                name: c.name,
                image1: img1, 
                image2: img2,
                prices: { usd: parseFloat(c.prices?.usd || 9999), eur: parseFloat(c.prices?.eur || 9999) },
                rank_edhrec: rank,
                color_identity: c.color_identity || [],
                isPartner: !!(c.keywords?.includes("Partner") || (c.type_line && c.type_line.includes("Background"))),
                scryfall_uri: c.scryfall_uri || "https://scryfall.com"
            };
        }).filter(x => x !== null);

        finalArray.sort((a, b) => a.rank_edhrec - b.rank_edhrec);
        await admin.database().ref('global_archives').set({ lastUpdated: Date.now(), cards: finalArray });
        console.log("--- SUCCESS: ARCHIVE SYNC COMPLETE ---");
    } catch (err) { console.error("FATAL ERROR:", err.message); throw err; }
}

async function verifyIsAdmin(auth) {
    if (!auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }
    const adminRef = admin.database().ref(`admins/${auth.uid}`);
    const adminSnap = await adminRef.once('value');
    if (!adminSnap.exists() || adminSnap.val() !== true) {
        console.log(`Admin verification failed for UID: ${auth.uid}`); // Server-side log for debugging
        throw new HttpsError('permission-denied', 'You do not have sufficient permissions to perform this action.');
    }
}

exports.buildWeeklyArchives = onSchedule({
    schedule: "every sunday 00:00",
    timeoutSeconds: 540,
    memory: "1GiB",
    cpu: 1
}, async (event) => {
    await performArchiveSync();
});

exports.manualArchiveSync = onCall({ timeoutSeconds: 540, memory: "1GiB", cpu: 1 }, async (request) => {
    await verifyIsAdmin(request.auth);
    await performArchiveSync();
    return { success: true };
});

exports.checkAdminStatus = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    const uid = request.auth.uid;
    const adminRef = admin.database().ref(`admins/${uid}`);
    const adminSnap = await adminRef.once('value');

    return { isAdmin: adminSnap.exists() && adminSnap.val() === true };
});

exports.getAdminData = onCall(async (request) => {
    await verifyIsAdmin(request.auth);

    const db = admin.database();
    const [roomsSnap, statsSnap, usersSnap] = await Promise.all([
        db.ref('rooms').once('value'),
        db.ref('stats').once('value'),
        db.ref('users').once('value')
    ]);

    const usersData = usersSnap.val() || {};

    try {
        const uids = Object.keys(usersData);
        // Fetch Auth data in batches of 100 for all existing users
        for (let i = 0; i < uids.length; i += 100) {
            const batchUids = uids.slice(i, i + 100).map(uid => ({ uid }));
            const userRecords = await admin.auth().getUsers(batchUids);
            
            userRecords.users.forEach(record => {
                let provider = 'Unknown';
                if (record.providerData && record.providerData.length > 0) {
                    const pid = record.providerData[0].providerId;
                    if (pid === 'google.com') provider = 'Google';
                    else if (pid === 'oidc.discord') provider = 'Discord';
                    else provider = pid;
                }
                if (usersData[record.uid]) {
                    if (!usersData[record.uid].profile) usersData[record.uid].profile = {};
                    if (!usersData[record.uid].profile.provider) usersData[record.uid].profile.provider = provider;
                }
            });
        }
    } catch (e) {
        console.error("Failed to fetch auth providers for users:", e);
    }

    return {
        rooms: roomsSnap.val() || {},
        stats: statsSnap.val() || {},
        users: usersData
    };
});

exports.adminDeleteRoom = onCall(async (request) => {
    await verifyIsAdmin(request.auth);

    const roomId = request.data.roomId;
    if (!roomId) throw new HttpsError('invalid-argument', 'Room ID required.');

    const db = admin.database();
    await db.ref(`rooms/${roomId}`).remove();
    await db.ref(`webhooks/${roomId}`).remove();
    
    return { success: true };
});

exports.adminPruneRooms = onCall(async (request) => {
    await verifyIsAdmin(request.auth);

    const db = admin.database();
    const snap = await db.ref('rooms').once('value');
    const rooms = snap.val() || {};
    let deletedCount = 0;
    const now = Date.now();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    const updates = {};
    
    for (const [code, data] of Object.entries(rooms)) {
        const pCount = data.players ? Object.keys(data.players).length : 0;
        let cTime = now;
        if (data.settings && data.settings.createdAt) cTime = data.settings.createdAt;
        else if (data.players) {
            const hostEntry = Object.entries(data.players).find(([k, v]) => v.isHost);
            if (hostEntry) {
                const parsedTime = parseInt(hostEntry[0]);
                if (!isNaN(parsedTime) && parsedTime > 1600000000000) cTime = parsedTime;
            }
        }
        if (pCount === 0 || (now - cTime > thirtyDays)) {
            updates[`rooms/${code}`] = null;
            updates[`webhooks/${code}`] = null;
            deletedCount++;
        }
    }
    if (deletedCount > 0) {
        await db.ref().update(updates);
    }
    return { deletedCount };
});

exports.adminViewRoom = onCall(async (request) => {
    await verifyIsAdmin(request.auth);

    const roomId = request.data.roomId;
    if (!roomId) throw new HttpsError('invalid-argument', 'Room ID required.');

    const snap = await admin.database().ref(`rooms/${roomId}`).once('value');
    return { room: snap.val() };
});

let cachedArchives = null;
let archivesFetchTime = 0;

exports.hostStartInteractiveDraft = onCall(async (request) => {
    const { roomId, settings } = request.data;
    if (!roomId || !settings) {
        throw new HttpsError('invalid-argument', 'Room ID and settings are required.');
    }

    await verifyIsHost(roomId, request.auth);

    const db = admin.database();

    const playersSnap = await db.ref(`rooms/${roomId}/players`).once('value');
    const players = playersSnap.val() || {};
    let playerIds = Object.keys(players);
    const N = playerIds.length;
    if (N === 0) {
        throw new HttpsError('failed-precondition', 'Cannot start a draft with no players.');
    }

    // Randomize the player order for the draft (Fisher-Yates shuffle)
    for (let i = playerIds.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [playerIds[i], playerIds[j]] = [playerIds[j], playerIds[i]];
    }

    const now = Date.now();
    if (!cachedArchives || (now - archivesFetchTime > 12 * 60 * 60 * 1000)) {
        const archivesSnap = await db.ref('global_archives/cards').once('value');
        cachedArchives = archivesSnap.val() || [];
        archivesFetchTime = now;
    }
    const archives = cachedArchives;
    const { budget, currency, noPartner, minRank, maxRank, numOptions } = settings;

    const pool = archives.filter(card => {
        const price = currency === 'eur' ? card.prices.eur : card.prices.usd;
        if (parseFloat(budget) !== 0 && price >= parseFloat(budget)) return false;
        if (noPartner && card.isPartner) return false;
        if (maxRank !== 0 && card.rank_edhrec < maxRank) return false;
        if (minRank !== 0 && card.rank_edhrec > minRank) return false;
        return true;
    });

    if (pool.length < N * numOptions) {
        throw new HttpsError('failed-precondition', `Not enough commanders in the Archives for this draft! Found ${pool.length}, need ${N * numOptions}.`);
    }

    // Base structure for the unified interactive draft engine
    const activeDraftPayload = {
        format: settings.draftFormat,
        createdAt: Date.now(),
        isComplete: false,
        playerOrder: playerIds
    };

    if (settings.draftFormat === 'async_draft') {
        const existingNames = new Set();
        const packs = [];
        for (let i = 0; i < N; i++) {
            const packCards = [];
            for (let j = 0; j < numOptions; j++) {
                let card; let attempts = 0;
                do { card = pool[Math.floor(Math.random() * pool.length)]; attempts++; } 
                while (existingNames.has(card.name) && attempts < 100);
                
                packCards.push({ 
                    name: card.name, image_uris: { normal: card.image1 }, card_faces: card.image2 ? [{ image_uris: { normal: card.image1 } }, { image_uris: { normal: card.image2 } }] : null, 
                    prices: card.prices, display_rank: card.rank_edhrec, color_identity: card.color_identity, scryfall_uri: card.scryfall_uri 
                });
                existingNames.add(card.name);
            }
            packs.push({ id: `pack_${i}`, cards: packCards });
        }
        
        const queues = {};
        const drafted = {};
        playerIds.forEach((id, i) => {
            queues[id] = [ packs[i] ];
            drafted[id] = [];
        });

        activeDraftPayload.queues = queues;
        activeDraftPayload.drafted = drafted;
        activeDraftPayload.draftGoal = numOptions;
    } else if (settings.draftFormat === 'snake_draft') {
        const existingNames = new Set();
        const poolCards = [];
        for (let i = 0; i < N * numOptions; i++) {
            let card; let attempts = 0;
            do { card = pool[Math.floor(Math.random() * pool.length)]; attempts++; } 
            while (existingNames.has(card.name) && attempts < 100);
            
            poolCards.push({ 
                name: card.name, image_uris: { normal: card.image1 }, card_faces: card.image2 ? [{ image_uris: { normal: card.image1 } }, { image_uris: { normal: card.image2 } }] : null, 
                prices: card.prices, display_rank: card.rank_edhrec, color_identity: card.color_identity, scryfall_uri: card.scryfall_uri 
            });
            existingNames.add(card.name);
        }

        const pickOrder = [];
        for (let round = 0; round < numOptions; round++) {
            let roundOrder = [...playerIds];
            if (round % 2 !== 0) roundOrder.reverse();
            pickOrder.push(...roundOrder);
        }

        const drafted = Object.fromEntries(playerIds.map(id => [id, []]));

        activeDraftPayload.pool = poolCards;
        activeDraftPayload.pickOrder = pickOrder;
        activeDraftPayload.turn = 0;
        activeDraftPayload.drafted = drafted;
        activeDraftPayload.draftGoal = numOptions;
    } else if (settings.draftFormat === 'burn_draft') {
        const existingNames = new Set();
        const packs = [];
        for (let i = 0; i < N; i++) {
            const packCards = [];
            for (let j = 0; j < numOptions; j++) {
                let card; let attempts = 0;
                do { card = pool[Math.floor(Math.random() * pool.length)]; attempts++; } 
                while (existingNames.has(card.name) && attempts < 100);
                
                packCards.push({ 
                    name: card.name, image_uris: { normal: card.image1 }, card_faces: card.image2 ? [{ image_uris: { normal: card.image1 } }, { image_uris: { normal: card.image2 } }] : null, 
                    prices: card.prices, display_rank: card.rank_edhrec, color_identity: card.color_identity, scryfall_uri: card.scryfall_uri 
                });
                existingNames.add(card.name);
            }
            packs.push({ id: `pack_${i}`, cards: packCards });
        }
        
        const queues = {};
        const drafted = {};
        playerIds.forEach((id, i) => {
            if (numOptions === 1) { drafted[id] = [ packs[i].cards[0] ]; queues[id] = []; } 
            else { queues[id] = [ packs[i] ]; drafted[id] = []; }
        });

        activeDraftPayload.queues = queues;
        activeDraftPayload.drafted = drafted;
        activeDraftPayload.draftGoal = 1;
        if (numOptions === 1) activeDraftPayload.isComplete = true;
    }

    await db.ref(`rooms/${roomId}`).update({ settings, activeDraft: activeDraftPayload });
    await db.ref('stats').update({ commandersRolled: admin.database.ServerValue.increment(N * numOptions) });

    return { success: true };
});

async function verifyIsHost(roomId, auth) {
    if (!auth) throw new HttpsError('unauthenticated', 'Not authenticated.');
    const snap = await admin.database().ref(`rooms/${roomId}/players`).once('value');
    const players = snap.val() || {};
    // Check if any player in the room is marked as host AND has a matching UID
    const isHost = Object.values(players).some(p => p.uid === auth.uid && p.isHost);
    if (!isHost) throw new HttpsError('permission-denied', 'Only the Host can perform this action.');
    return players;
}

exports.hostKickPlayer = onCall(async (request) => {
    const { roomId, targetId } = request.data;
    if (!roomId || !targetId) throw new HttpsError('invalid-argument', 'Missing parameters.');
    await verifyIsHost(roomId, request.auth);
    
    await admin.database().ref(`rooms/${roomId}/players/${targetId}`).remove();
    return { success: true };
});

exports.hostClearPlayer = onCall(async (request) => {
    const { roomId, targetId } = request.data;
    if (!roomId || !targetId) throw new HttpsError('invalid-argument', 'Missing parameters.');
    await verifyIsHost(roomId, request.auth);

    await admin.database().ref(`rooms/${roomId}/players/${targetId}`).update({
        selected: null, image: null, display_rank: null, scryfall_uri: null, deck: null, deckPrice: null, lockedDeckPrice: null, deckSize: null, deckSalt: null, isLegal: null, generated: null, rerollCount: 0
    });
    return { success: true };
});

exports.hostResetLobby = onCall(async (request) => {
    const { roomId } = request.data;
    if (!roomId) throw new HttpsError('invalid-argument', 'Missing parameters.');
    const players = await verifyIsHost(roomId, request.auth);

    let updates = {};
    Object.keys(players).forEach(id => {
        updates[`players/${id}/generated`] = null;
        updates[`players/${id}/selected`] = null;
        updates[`players/${id}/deck`] = null;
        updates[`players/${id}/deckPrice`] = null;
        updates[`players/${id}/lockedDeckPrice`] = null;
        updates[`players/${id}/deckSize`] = null;
        updates[`players/${id}/deckSalt`] = null;
        updates[`players/${id}/isLegal`] = null;
        updates[`players/${id}/rerollCount`] = 0;
        updates[`players/${id}/image`] = null;
    });
    updates['settings/status'] = 'waiting';
    updates['activeDraft'] = null;
    updates['meetup'] = null;

    await admin.database().ref(`rooms/${roomId}`).update(updates);
    return { success: true };
});

exports.hostDeclareWinner = onCall(async (request) => {
    const { roomId, winnerId } = request.data;
    if (!roomId || !winnerId) throw new HttpsError('invalid-argument', 'Missing parameters.');
    const players = await verifyIsHost(roomId, request.auth);

    const winner = players[winnerId];
    if (!winner) throw new HttpsError('not-found', 'Winner not found.');

    const historyId = Date.now().toString();
    const historyRecord = {
        date: Date.now(),
        winnerId: winnerId,
        winnerName: winner.name,
        commander: winner.selected || "Unknown",
        deck: winner.deck || null
    };

    const winnerUid = winner.uid;
    if (winnerUid) {
        const db = admin.database();
        const winnerName = winner.name || "Unknown";
        const winnerAvatar = winner.avatar || null;
        const commanderName = winner.selected || "Unknown";

        // 1. Update user-specific stats
        const userStatsRef = db.ref(`users/${winnerUid}/stats`);
        await userStatsRef.child('wins').transaction(current => (current || 0) + 1);
        
        const winRecord = { commander: commanderName, date: Date.now(), room: roomId };
        await userStatsRef.child('win_history').push(winRecord);

        
    }

    let updates = {};
    updates[`history/${historyId}`] = historyRecord;
    updates['settings/status'] = 'waiting';
    updates['meetup'] = null;
    updates['activeDraft'] = null;

    Object.keys(players).forEach(id => {
        updates[`players/${id}/generated`] = null;
        updates[`players/${id}/selected`] = null;
        updates[`players/${id}/deck`] = null;
        updates[`players/${id}/deckPrice`] = null;
        updates[`players/${id}/lockedDeckPrice`] = null;
        updates[`players/${id}/deckSize`] = null;
        updates[`players/${id}/deckSalt`] = null;
        updates[`players/${id}/isLegal`] = null;
        updates[`players/${id}/rerollCount`] = 0;
        updates[`players/${id}/image`] = null;
    });

    await admin.database().ref(`rooms/${roomId}`).update(updates);
    return { success: true, winnerName: winner.name };
});

async function sendDiscordWebhook(roomId, content) {
    const snap = await admin.database().ref(`webhooks/${roomId}/url`).once('value');
    const url = snap.val();
    if (!url || !url.startsWith("https://discord.com/api/webhooks/")) return;
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content, username: "Commander Archives" }),
            signal: controller.signal
        });
        clearTimeout(timeout);
    } catch (e) {
        console.error("Discord webhook error:", e);
    }
}

async function sendRoomNotification(roomId, payload, excludeUid = null) {
    const db = admin.database();
    const playersSnap = await db.ref(`rooms/${roomId}/players`).once('value');
    if (!playersSnap.exists()) return;
    
    const players = playersSnap.val();
    let targetTokens = [];
    let tokenToUidMap = {};

    for (const playerId in players) {
        const uid = players[playerId].uid;
        if (uid && uid !== excludeUid) {
            const tokensSnap = await db.ref(`users/${uid}/fcmTokens`).once('value');
            if (tokensSnap.exists()) {
                Object.keys(tokensSnap.val()).forEach(token => {
                    targetTokens.push(token);
                    tokenToUidMap[token] = uid;
                });
            }
        }
    }

    if (targetTokens.length === 0) return;

    const message = {
        notification: {
            title: payload.title,
            body: payload.body,
        },
        data: {
            url: payload.url || `/?room=${roomId}`
        },
        tokens: targetTokens
    };

    try {
        const response = await admin.messaging().sendMulticast(message);
        console.log(`Sent ${response.successCount} push notifications successfully.`);
        
        // Automatically clean up invalid/expired tokens to prevent database bloat
        if (response.failureCount > 0) {
            const tokenRemovals = {};
            response.responses.forEach((resp, idx) => {
                if (!resp.success && (resp.error.code === 'messaging/invalid-registration-token' || resp.error.code === 'messaging/registration-token-not-registered')) {
                    const deadToken = targetTokens[idx];
                    const deadUid = tokenToUidMap[deadToken];
                    if (deadUid) tokenRemovals[`users/${deadUid}/fcmTokens/${deadToken}`] = null;
                }
            });
            if (Object.keys(tokenRemovals).length > 0) {
                await db.ref().update(tokenRemovals);
                console.log(`Pruned ${Object.keys(tokenRemovals).length} dead FCM tokens.`);
            }
        }
    } catch (error) {
        console.error('Error sending multicast message:', error);
    }
}

exports.notifyDraftStarted = onValueUpdated({ ref: "/rooms/{roomId}/settings/status", instance: "commander-challenge-default-rtdb", region: "europe-west1" }, async (event) => {
    const before = event.data.before.val();
    const after = event.data.after.val();
    if (before !== 'waiting' || after !== 'rolling') return;
    
    await sendDiscordWebhook(event.params.roomId, `🎲 **A new Commander Draft has begun!**\nJoin the playgroup: https://edhchallenge.com/?room=${event.params.roomId}`);

    return sendRoomNotification(event.params.roomId, {
        title: "Draft Started! 🎲",
        body: "The Host has started a new Commander Draft! Enter the Archives.",
        url: `/?room=${event.params.roomId}`
    });
});

exports.onRoomCreated = onValueCreated({ ref: "/rooms/{roomId}", instance: "commander-challenge-default-rtdb", region: "europe-west1" }, async (event) => {
    await admin.database().ref('stats').update({ activeRooms: admin.database.ServerValue.increment(1) });
});

exports.onRoomDeleted = onValueDeleted({ ref: "/rooms/{roomId}", instance: "commander-challenge-default-rtdb", region: "europe-west1" }, async (event) => {
    await admin.database().ref('stats').update({ activeRooms: admin.database.ServerValue.increment(-1) });
});

exports.onPlayerJoined = onValueCreated({ ref: "/rooms/{roomId}/players/{playerId}", instance: "commander-challenge-default-rtdb", region: "europe-west1" }, async (event) => {
    await admin.database().ref('stats').update({ totalPlayers: admin.database.ServerValue.increment(1) });
});

exports.logCommandersRolled = onCall(async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Not authenticated.');
    const count = request.data.count;
    if (!Number.isInteger(count) || count < 1 || count > 5) throw new HttpsError('invalid-argument', 'Invalid roll count.');
    await admin.database().ref('stats').update({ commandersRolled: admin.database.ServerValue.increment(count) });
    return { success: true };
});

exports.notifyPlayerProgress = onValueUpdated({ ref: "/rooms/{roomId}/players/{playerId}", instance: "commander-challenge-default-rtdb", region: "europe-west1" }, async (event) => {
    const before = event.data.before.val() || {};
    const after = event.data.after.val() || {};
    if (!after.name) return; // Player left/kicked

    let title = null;
    let body = null;
    
    const roomSnap = await admin.database().ref(`rooms/${event.params.roomId}`).once('value');
    const roomData = roomSnap.val();
    if (!roomData) return;

    const isBlind = roomData.settings?.blindDraft === true;
    const players = roomData.players || {};
    const allLocked = Object.values(players).every(p => p.selected);
    const hideInfo = isBlind && !allLocked;

    if (!before.selected && after.selected) {
        title = "Commander Locked In! 🔒";
        body = hideInfo ? `${after.name} has locked in a mysterious Commander!` : `${after.name} has chosen ${after.selected}!`;
        
        const edhrecSlug = after.selected.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const edhrecLink = `https://edhrec.com/commanders/${edhrecSlug}`;
        const discordMsg = hideInfo ? `🔒 **${after.name}** has locked in a mysterious Commander!` : `🔒 **${after.name}** has chosen **${after.selected}**!\n${edhrecLink}`;
        await sendDiscordWebhook(event.params.roomId, discordMsg);

        if (allLocked) {
            const revealMsg = `🎉 **${isBlind ? 'All Commanders Revealed!' : 'All Commanders Locked In!'}** 🎉\n${isBlind ? 'The Blind Draft is complete! The board is now revealed.' : 'Everyone has chosen their commanders. Time to brew!'}\nhttps://edhchallenge.com/?room=${event.params.roomId}`;
            await sendDiscordWebhook(event.params.roomId, revealMsg);
            
            title = isBlind ? "All Commanders Revealed! 🎭" : "Draft Phase Complete! 🎉";
            body = isBlind ? "The Blind Draft is over! Check the board to see the matchups." : "Everyone has locked in their commanders.";
        }
    } else if (after.deck) {
        const maxBudget = roomData.settings?.deckBudget !== undefined ? parseFloat(roomData.settings?.deckBudget) : 50;
        
        const beforePrice = before.lockedDeckPrice !== undefined ? before.lockedDeckPrice : (before.deckPrice || 0);
        const afterPrice = after.lockedDeckPrice !== undefined ? after.lockedDeckPrice : (after.deckPrice || 0);
        
        const wasReady = before.deck && before.isLegal && (maxBudget === 0 || beforePrice <= maxBudget);
        const isReady = after.isLegal && (maxBudget === 0 || afterPrice <= maxBudget);

        const deckLinkDisplay = hideInfo ? "*(Deck link hidden until all players lock in their commanders!)*" : after.deck;

        if (!wasReady && isReady) {
            title = "Ready for Battle! ✅";
            body = `${after.name}'s deck is fully legal and under budget!`;
            await sendDiscordWebhook(event.params.roomId, `✅ **${after.name}**'s deck is fully legal, under budget, and **Ready for Battle**!\n${deckLinkDisplay}`);
        } else if (!before.deck && after.deck && !isReady) {
            title = "Deck Sealed! 🛡️";
            body = `${after.name} has submitted a deck link.`;
            await sendDiscordWebhook(event.params.roomId, `🛡️ **${after.name}** has sealed their deck!\n${deckLinkDisplay}`);
        }
    }

    if (title && body) {
        return sendRoomNotification(event.params.roomId, {
            title: title, body: body, url: `/?room=${event.params.roomId}`
        }, after.uid);
    }
});

exports.notifyBattleScheduled = onValueWritten({ ref: "/rooms/{roomId}/meetup", instance: "commander-challenge-default-rtdb", region: "europe-west1" }, async (event) => {
    const before = event.data.before.val();
    const after = event.data.after.val();
    
    if (!after) return; // Meetup was completely canceled/removed

    // If the meetup is brand new or the date was changed
    if (!before || before.date !== after.date) {
        const dateObj = new Date(after.date);
        const dateStr = dateObj.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        let discordMsg = `📅 **Battle Scheduled!**\n**Date:** ${dateStr}\n**Format:** ${after.format}\n**Prize:** ${after.prize}`;
        if (after.location) discordMsg += `\n**Location:** ${after.location}`;
        await sendDiscordWebhook(event.params.roomId, discordMsg);

        return sendRoomNotification(event.params.roomId, {
            title: "Battle Scheduled! 📅",
            body: `A match is set for ${dateStr}. Format: ${after.format}`,
            url: `/?room=${event.params.roomId}`
        });
    }

    // If the date remained the same, check if player availability toggled
    if (before && after && before.date === after.date) {
        const beforeCant = before.cantMakeIt || {};
        const afterCant = after.cantMakeIt || {};
        const allKeys = new Set([...Object.keys(beforeCant), ...Object.keys(afterCant)]);
        
        for (const playerId of allKeys) {
            const wasCantMakeIt = beforeCant[playerId];
            const isCantMakeIt = afterCant[playerId];
            if (!wasCantMakeIt && isCantMakeIt) {
                const playerSnap = await admin.database().ref(`rooms/${event.params.roomId}/players/${playerId}/name`).once('value');
                if (playerSnap.val()) await sendDiscordWebhook(event.params.roomId, `⚠️ **${playerSnap.val()}** can no longer make the scheduled date!`);
            } else if (wasCantMakeIt && !isCantMakeIt) {
                const playerSnap = await admin.database().ref(`rooms/${event.params.roomId}/players/${playerId}/name`).once('value');
                if (playerSnap.val()) await sendDiscordWebhook(event.params.roomId, `✅ **${playerSnap.val()}** can make the scheduled date again!`);
            }
        }
    }
});

exports.notifyWinnerDeclared = onValueCreated({ ref: "/rooms/{roomId}/history/{historyId}", instance: "commander-challenge-default-rtdb", region: "europe-west1" }, async (event) => {
    const history = event.data.val();
    const edhrecSlug = history.commander.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const edhrecLink = `https://edhrec.com/commanders/${edhrecSlug}`;
    await sendDiscordWebhook(event.params.roomId, `🏆 **${history.winnerName}** has claimed victory with **${history.commander}**!\n${edhrecLink}\nCongratulations to the champion!`);

    return sendRoomNotification(event.params.roomId, {
        title: "Winner Declared! 🏆",
        body: `${history.winnerName} has claimed victory with ${history.commander}!`,
        url: `/?room=${event.params.roomId}`
    });
});