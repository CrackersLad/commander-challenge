import { app, db, auth, googleProvider, discordProvider } from './firebase-setup.js?v=19.26';
import { ref, get, update, onValue } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";
import { signInWithPopup, signOut, onAuthStateChanged, signInAnonymously, linkWithPopup, signInWithCredential, GoogleAuthProvider, OAuthProvider } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { getMessaging, getToken, onMessage, isSupported } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging.js";

export function initAuthModule(utils, state) {
    const { playSound, showToast } = utils;

    onAuthStateChanged(auth, (user) => {
        try {
            const loggedOutUI = document.getElementById('loggedOutUI');
            const loggedInUI = document.getElementById('loggedInUI');
            const authUserName = document.getElementById('authUserName');
            const playerNameInput = document.getElementById('playerNameInput');
            const globalAccountName = document.getElementById('globalAccountName');
            const globalAvatar = document.getElementById('globalAvatar');
            const enableNotificationsBtn = document.getElementById('enableNotificationsBtn');

            if (user && !user.isAnonymous) {
                let bestAvatar = user.photoURL; let bestName = user.displayName || user.email || "Player";
                if (user.providerData && user.providerData.length > 0) {
                    const discordData = user.providerData.find(p => p.providerId === 'oidc.discord');
                    const googleData = user.providerData.find(p => p.providerId === 'google.com');
                    if (discordData) { if (discordData.photoURL) bestAvatar = discordData.photoURL; if (discordData.displayName) bestName = discordData.displayName; } 
                    else if (googleData && !bestAvatar) { if (googleData.photoURL) bestAvatar = googleData.photoURL; }
                }

                if (loggedOutUI) loggedOutUI.style.display = 'none';
                if (loggedInUI) loggedInUI.style.display = 'block';

                const isDiscord = user.providerData?.some(p => p.providerId === 'oidc.discord');
                const providerStr = isDiscord ? 'Discord' : (user.providerData?.some(p => p.providerId === 'google.com') ? 'Google' : 'Unknown');
                
                const providerLabel = document.getElementById('authProviderName');
                if (providerLabel) providerLabel.innerText = isDiscord ? 'Discord' : 'Google';
                if (globalAccountName) globalAccountName.innerText = bestName;
                
                update(ref(db, `users/${user.uid}/profile`), { provider: providerStr }).catch(e => console.warn("Could not save provider:", e));

                const authAvatar = document.getElementById('authAvatar');
                if (bestAvatar) {
                    if (authAvatar) { authAvatar.src = bestAvatar; authAvatar.style.display = 'block'; }
                    if (globalAvatar) { globalAvatar.src = bestAvatar; globalAvatar.style.display = 'block'; }
                    state.currentPlayerAvatar = bestAvatar; localStorage.setItem('playerAvatar', bestAvatar);
                } else {
                    if (authAvatar) authAvatar.style.display = 'none'; if (globalAvatar) globalAvatar.style.display = 'none';
                    state.currentPlayerAvatar = null; localStorage.removeItem('playerAvatar');
                }

                if (!localStorage.getItem('guestName') && state.currentPlayerName) localStorage.setItem('guestName', state.currentPlayerName);

                if (enableNotificationsBtn) {
                    if (Notification.permission === 'default') enableNotificationsBtn.style.display = 'block';
                    else enableNotificationsBtn.style.display = 'none';
                    enableNotificationsBtn.onclick = () => { playSound('sfx-click'); requestPushPermissions(user.uid); };
                }

                if (state.activeUserProfileListener) { state.activeUserProfileListener(); state.activeUserProfileListener = null; }
                state.activeUserProfileListener = onValue(ref(db, `users/${user.uid}/profile`), (snap) => {
                    const profile = snap.val() || {}; const finalName = profile.nickname || bestName || "Player";
                    const nickInput = document.getElementById('customNicknameInput');
                    if (nickInput && document.activeElement !== nickInput) nickInput.value = finalName;
                    if (globalAccountName) globalAccountName.innerText = finalName;

                    if (finalName && finalName !== "Player") {
                        state.currentPlayerName = finalName; localStorage.setItem('playerName', finalName);
                        if (playerNameInput && document.activeElement !== playerNameInput) playerNameInput.value = finalName;
                    }

                    get(ref(db, 'rooms')).then(snapRooms => {
                        const rooms = snapRooms.val() || {}; const updatePromises = [];
                        Object.entries(rooms).forEach(([code, roomData]) => {
                            if (roomData.players && roomData.players[state.currentPlayerId]) {
                                const pData = roomData.players[state.currentPlayerId]; const roomUpdates = {};
                                roomUpdates[`players/${state.currentPlayerId}/name`] = finalName;
                                roomUpdates[`players/${state.currentPlayerId}/avatar`] = bestAvatar || null;
                                roomUpdates[`players/${state.currentPlayerId}/uid`] = user.uid;
                                if (!pData.guestName) roomUpdates[`players/${state.currentPlayerId}/guestName`] = localStorage.getItem('guestName') || pData.name;
                                updatePromises.push(update(ref(db, `rooms/${code}`), roomUpdates));
                            }
                        });
                        if (updatePromises.length > 0) { Promise.all(updatePromises).then(() => { if (document.getElementById('view-landing').classList.contains('active')) window.loadMyPlaygroups(); }).catch(e => console.error(e)); } 
                        else { if (document.getElementById('view-landing').classList.contains('active')) window.loadMyPlaygroups(); }
                    }).catch(e => console.error(e));
                }, (err) => console.warn("Profile read skipped:", err.message));

            } else {
                if (state.activeUserProfileListener) { state.activeUserProfileListener(); state.activeUserProfileListener = null; }
                if (loggedOutUI) loggedOutUI.style.display = 'block';
                if (loggedInUI) loggedInUI.style.display = 'none';
                
                const globalAcc = document.getElementById('globalAccountName'); if (globalAcc) globalAcc.innerText = "Guest";
                const globalAv = document.getElementById('globalAvatar'); if (globalAv) globalAv.style.display = 'none';
                state.currentPlayerAvatar = null; localStorage.removeItem('playerAvatar');

                const savedGuestName = localStorage.getItem('guestName') || localStorage.getItem('playerName');
                if (savedGuestName) { 
                    state.currentPlayerName = savedGuestName; 
                    localStorage.setItem('guestName', savedGuestName);
                    localStorage.setItem('playerName', savedGuestName); 
                    if (playerNameInput) playerNameInput.value = savedGuestName; 
                }

                if (window.isExplicitSignOut) {
                    window.isExplicitSignOut = false;
                    get(ref(db, 'rooms')).then(roomsSnap => {
                        const rooms = roomsSnap.val() || {}; const updatePromises = [];
                        Object.entries(rooms).forEach(([code, roomData]) => {
                            if (roomData.players && roomData.players[state.currentPlayerId]) {
                                const pData = roomData.players[state.currentPlayerId]; const gName = pData.guestName || savedGuestName || pData.name; const roomUpdates = {};
                                roomUpdates[`players/${state.currentPlayerId}/name`] = gName; roomUpdates[`players/${state.currentPlayerId}/avatar`] = null; roomUpdates[`players/${state.currentPlayerId}/uid`] = null;
                                updatePromises.push(update(ref(db, `rooms/${code}`), roomUpdates));
                            }
                        });
                        if (updatePromises.length > 0) { Promise.all(updatePromises).then(() => { if (document.getElementById('view-landing').classList.contains('active')) window.loadMyPlaygroups(); }).catch(e => console.error(e)); } 
                        else { if (document.getElementById('view-landing').classList.contains('active')) window.loadMyPlaygroups(); }
                    }).catch(e => console.error(e));
                } else {
                    if (document.getElementById('view-landing').classList.contains('active')) window.loadMyPlaygroups();
                }
                if (!user) signInAnonymously(auth).catch(e => console.error("Anonymous Auth Failed:", e));
            }
        } catch(err) { console.error("Auth state error:", err); }
    });

    async function handleLogin(provider) {
        try {
            const user = auth.currentUser;
            if (user && user.isAnonymous) { await linkWithPopup(user, provider); showToast("Account linked! Your stats are saved.", false, 3000, true); } 
            else { await signInWithPopup(auth, provider); }
        } catch (e) {
            if (e.code === 'auth/credential-already-in-use') {
                try {
                    const credential = provider.providerId === 'google.com' ? GoogleAuthProvider.credentialFromError(e) : OAuthProvider.credentialFromError(e);
                    if (credential) { await signInWithCredential(auth, credential); showToast("Logged into existing account.", false, 3000, true); } 
                    else { showToast("Account already exists. Please sign out of guest to log in.", true); }
                } catch (err) { if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') showToast("Login failed: " + err.message, true); }
            } else if (e.code === 'auth/popup-blocked') { showToast("Popup blocked! Please allow popups for this site.", true); } 
            else { if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') showToast("Login failed: " + e.message, true); }
        } finally {
            const modal = document.getElementById('accountModal'); if (modal) { modal.classList.remove('show'); setTimeout(() => modal.style.display='none', 300); }
        }
    }

    const saveNickBtn = document.getElementById('saveNicknameBtn');
    if (saveNickBtn) {
        saveNickBtn.onclick = async () => {
            playSound('sfx-click');
            const nickInput = document.getElementById('customNicknameInput'); if (!nickInput) return;
            const newName = nickInput.value.trim(); if (!newName) return showToast("Display name cannot be empty.", true);
            if (state.currentPlayerId && auth.currentUser && !auth.currentUser.isAnonymous) {
                const btn = saveNickBtn; btn.innerText = "Saving..."; btn.disabled = true;
                try { await update(ref(db, `users/${auth.currentUser.uid}/profile`), { nickname: newName }); showToast("Display name updated!", false, 3000, true); } 
                catch(e) { console.error("Save name error:", e); showToast("Failed to update name: " + e.message, true); } 
                finally { btn.innerText = "Save"; btn.disabled = false; }
            }
        };
    }

    const loginBtn = document.getElementById('loginGoogleBtn'); if (loginBtn) loginBtn.onclick = () => handleLogin(googleProvider);
    const loginDiscordBtn = document.getElementById('loginDiscordBtn'); if (loginDiscordBtn) loginDiscordBtn.onclick = () => handleLogin(discordProvider);

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.onclick = () => {
            playSound('sfx-click'); window.isExplicitSignOut = true;
            signOut(auth).then(() => {
                document.getElementById('accountModal').classList.remove('show'); setTimeout(() => document.getElementById('accountModal').style.display='none', 300); showToast("Reverted to Guest Mode.", false, 3000, true); 
            });
        };
    }

    async function requestPushPermissions(uid) {
        try {
            const permission = await Notification.requestPermission();
            if (permission === 'granted') {
                const supported = await isSupported();
                if (!supported) return showToast("Push notifications are not supported in this browser.", true);

                const messaging = getMessaging(app);
                const swRegistration = await navigator.serviceWorker.getRegistration();

                // NOTE: You must generate a VAPID key in the Firebase Console (Project Settings > Cloud Messaging > Web configuration)
                // Replace 'YOUR_VAPID_KEY_HERE' below with your actual key.
                const token = await getToken(messaging, { vapidKey: 'BMk1hzKGyWMBxOCWrSPB2-xb3zF5BakEb4kU5_Gq2_gSsDaZZ3hJ9rhcNkj43sxsItODXdq-2Rph-XhcAl2EFVA', serviceWorkerRegistration: swRegistration });
                
                if (token) {
                    await update(ref(db, `users/${uid}/fcmTokens`), { [token]: true });
                    showToast("Push Notifications enabled!", false, 3000, true);
                    const btn = document.getElementById('enableNotificationsBtn');
                    if (btn) btn.style.display = 'none';
                    
                    // Listen for foreground messages (when user has the app open)
                    onMessage(messaging, (payload) => {
                        showToast(`🔔 ${payload.notification?.title}: ${payload.notification?.body}`, false, 5000, true);
                    });
                } else {
                    showToast("Failed to generate notification token.", true);
                }
            } else {
                showToast("Notification permission denied.", true);
            }
        } catch (error) {
            console.error('FCM Error:', error); showToast("Failed to enable notifications.", true);
        }
    }
}