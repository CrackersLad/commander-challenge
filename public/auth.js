import { app, db, auth, googleProvider, discordProvider } from './firebase-setup.js?v=0.41';
import { ref, get, update, onValue } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";
import { signInWithPopup, signOut, onAuthStateChanged, signInAnonymously, linkWithPopup, signInWithCredential, GoogleAuthProvider, OAuthProvider, linkWithCredential, signInWithRedirect, linkWithRedirect, getRedirectResult } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { getMessaging, getToken, onMessage, isSupported } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging.js";

export function initAuthModule(utils, state) {
    const { playSound, showToast } = utils;

    getRedirectResult(auth).then(async (result) => {
        if (result && result.user) {
            showToast("Discord Login successful!", false, 3000, true);
        }
    }).catch(async (error) => {
        if (error.code === 'auth/credential-already-in-use') {
            try {
                const credential = OAuthProvider.credentialFromError(error);
                if (credential) {
                    await signInWithCredential(auth, credential);
                    showToast("Logged into existing account.", false, 3000, true);
                }
            } catch (err) {
                showToast("Login failed: " + err.message, true);
            }
        } else if (error.code !== 'auth/redirect-cancelled-by-user') {
            showToast("Login failed: " + error.message, true);
        }
    });

    onAuthStateChanged(auth, async (user) => {
        try {
            if (user && !user.isAnonymous) {
                await handleAuthenticatedUser(user);
            } else {
                await handleGuestUser(user);
            }
        } catch (err) {
            console.error("Auth state error:", err);
        }
    });

    async function handleAuthenticatedUser(user) {
        let bestAvatar = user.photoURL;
        let bestName = user.displayName || user.email || "Player";
        
        const discordData = user.providerData?.find(p => p.providerId === 'oidc.discord');
        const googleData = user.providerData?.find(p => p.providerId === 'google.com');
        
        if (discordData) {
            if (discordData.photoURL) bestAvatar = discordData.photoURL;
            if (discordData.displayName) bestName = discordData.displayName;
        } else if (googleData && !bestAvatar) {
            if (googleData.photoURL) bestAvatar = googleData.photoURL;
        }

        const cachedName = localStorage.getItem('playerName');
        if (cachedName) bestName = cachedName;

        const isDiscord = !!discordData;
        const providerStr = isDiscord ? 'Discord' : (googleData ? 'Google' : 'Unknown');

        updateAuthUI(true, bestName, bestAvatar, providerStr);
        
        update(ref(db, `users/${user.uid}/profile`), { provider: providerStr })
            .catch(e => console.warn("Could not save provider:", e));

        if (!localStorage.getItem('guestName') && state.currentPlayerName) {
            localStorage.setItem('guestName', state.currentPlayerName);
        }

        // CRITICAL FIX: Run cross-device recovery BEFORE syncing identity to Firebase
        // This prevents the new mobile ID from overwriting the database before we can adopt the web ID!
        // Cross-device room recovery: Find all active rooms this user is in and add them to local storage
        try {
            const snap = await get(ref(db, 'rooms'));
            if (snap.exists()) {
                const allRooms = snap.val();
                let joined = JSON.parse(localStorage.getItem('joinedRooms') || '[]');
                let foundNew = false;
                let validPlayerIds = [];
                
                Object.entries(allRooms).forEach(([code, rData]) => {
                    if (!rData.settings) return; // Skip ghost rooms
                    if (rData.players) {
                        const matchedEntry = Object.entries(rData.players).find(([pId, p]) => p.uid === user.uid);
                        if (matchedEntry) {
                            validPlayerIds.push(matchedEntry[0]);
                            if (!joined.includes(code)) { joined.push(code); foundNew = true; }
                        }
                    }
                });
                
                if (validPlayerIds.length > 0 && !validPlayerIds.includes(state.currentPlayerId)) {
                    localStorage.setItem('playerId', validPlayerIds[0]);
                    localStorage.setItem('joinedRooms', JSON.stringify(joined));
                    window.location.reload();
                    return;
                } else if (foundNew) {
                    localStorage.setItem('joinedRooms', JSON.stringify(joined));
                    if (document.getElementById('view-landing').classList.contains('active') && window.loadMyPlaygroups) window.loadMyPlaygroups();
                }
            }
        } catch (e) { console.warn("Failed to recover cross-device rooms:", e); }

        setupNotificationButton(user.uid);
        listenToUserProfile(user.uid, bestName, bestAvatar);
    }

    async function handleGuestUser(user) {
        if (state.activeUserProfileListener) {
            state.activeUserProfileListener();
            state.activeUserProfileListener = null;
        }
        
        const savedGuestName = localStorage.getItem('guestName') || localStorage.getItem('playerName');
        if (savedGuestName) {
            state.currentPlayerName = savedGuestName;
            localStorage.setItem('guestName', savedGuestName);
            localStorage.setItem('playerName', savedGuestName);
            const playerNameInput = document.getElementById('playerNameInput');
            if (playerNameInput) playerNameInput.value = savedGuestName;
        }

        updateAuthUI(false, savedGuestName || "Guest");

        if (window.isExplicitSignOut) {
            window.isExplicitSignOut = false;
            await syncRoomsWithIdentity(savedGuestName, null, null);
        } else {
            if (document.getElementById('view-landing').classList.contains('active')) {
                window.loadMyPlaygroups();
            }
        }

        if (!user) {
            signInAnonymously(auth).catch(e => console.error("Anonymous Auth Failed:", e));
        } else {
            setupNotificationButton(user.uid);
        }
    }

    function updateAuthUI(isLoggedIn, name = "Guest", avatar = null, provider = "") {
        const loggedOutUI = document.getElementById('loggedOutUI');
        const loggedInUI = document.getElementById('loggedInUI');
        const globalAccountName = document.getElementById('globalAccountName');
        const globalAvatar = document.getElementById('globalAvatar');
        const authAvatar = document.getElementById('authAvatar');
        const providerLabel = document.getElementById('authProviderName');

        if (isLoggedIn) {
            if (loggedOutUI) loggedOutUI.style.display = 'none';
            if (loggedInUI) loggedInUI.style.display = 'block';
            if (providerLabel) providerLabel.innerText = provider;
            if (globalAccountName) globalAccountName.innerText = name;

            if (avatar) {
                if (authAvatar) { authAvatar.src = avatar; authAvatar.style.display = 'block'; }
                if (globalAvatar) { globalAvatar.src = avatar; globalAvatar.style.display = 'block'; }
                state.currentPlayerAvatar = avatar;
                localStorage.setItem('playerAvatar', avatar);
            } else {
                if (authAvatar) authAvatar.style.display = 'none';
                if (globalAvatar) globalAvatar.style.display = 'none';
                state.currentPlayerAvatar = null;
                localStorage.removeItem('playerAvatar');
            }
        } else {
            if (loggedOutUI) loggedOutUI.style.display = 'block';
            if (loggedInUI) loggedInUI.style.display = 'none';
            if (globalAccountName) globalAccountName.innerText = name || "Guest";
            if (globalAvatar) globalAvatar.style.display = 'none';
            state.currentPlayerAvatar = null;
            localStorage.removeItem('playerAvatar');
        }
    }

    function setupNotificationButton(uid) {
        const enableNotificationsBtn = document.getElementById('enableNotificationsBtn');
        if (enableNotificationsBtn) {
            enableNotificationsBtn.style.display = 'block';

            const updateUIState = (status) => {
                if (status === 'granted') {
                    enableNotificationsBtn.innerHTML = '✅ Notifications Enabled <span style="font-size:0.8em; opacity:0.8;">(Tap to re-sync)</span>';
                    enableNotificationsBtn.disabled = false;
                    enableNotificationsBtn.style.opacity = '1';
                } else if (status === 'denied') {
                    enableNotificationsBtn.innerText = '❌ OS Blocked Notifications';
                    enableNotificationsBtn.disabled = false;
                    enableNotificationsBtn.style.opacity = '0.5';
                } else {
                    enableNotificationsBtn.innerText = '🔔 Enable Notifications';
                    enableNotificationsBtn.disabled = false;
                    enableNotificationsBtn.style.opacity = '1';
                }
            };

            if ('Notification' in window) {
                updateUIState(Notification.permission);
                if (Notification.permission === 'granted') requestPushPermissions(uid, true);
            } else {
                enableNotificationsBtn.innerText = '📱 Push Not Supported';
                enableNotificationsBtn.style.opacity = '0.7';
                enableNotificationsBtn.onclick = () => {
                    playSound('sfx-click');
                    showToast("To enable notifications on iOS, tap 'Share' then 'Add to Home Screen'.", false, 6000, true);
                };
                return;
            }
            enableNotificationsBtn.onclick = async () => {
                playSound('sfx-click');
                if (enableNotificationsBtn.innerText.includes('Blocked')) {
                    showToast("Blocked by browser/OS. Please open site settings to allow notifications.", true, 4000);
                    return;
                }
                await requestPushPermissions(uid);
                if ('Notification' in window) {
                    updateUIState(Notification.permission);
                }
            };
        }
    }

    function listenToUserProfile(uid, fallbackName, bestAvatar) {
        if (state.activeUserProfileListener) {
            state.activeUserProfileListener();
            state.activeUserProfileListener = null;
        }
        
        state.activeUserProfileListener = onValue(ref(db, `users/${uid}/profile`), async (snap) => {
            const profile = snap.val() || {};
            const finalName = profile.nickname || fallbackName || "Player";
            
            let wins = 0;
            if (profile.wins !== undefined && profile.wins !== null) wins = profile.wins;
            else {
                const winsSnap = await get(ref(db, `users/${uid}/wins`));
                if (winsSnap.exists()) wins = winsSnap.val();
            }

            const winHistory = profile.winHistory || [];
            updateAccountUI(finalName, bestAvatar, wins, winHistory);
            
            if (state.currentPlayerId && auth.currentUser && auth.currentUser.uid === uid) {
                state.currentPlayerName = finalName;
                state.currentPlayerAvatar = bestAvatar;
                localStorage.setItem('playerName', finalName);
                if (document.getElementById('playerNameInput') && !document.getElementById('playerNameInput').value.trim()) {
                    document.getElementById('playerNameInput').value = finalName;
                }
                await syncNameToCurrentRoom(finalName, bestAvatar);
            }

            if (document.getElementById('view-landing')?.classList.contains('active') && window.loadMyPlaygroups) {
                window.loadMyPlaygroups();
            }
        });
    }

    function updateAccountUI(name, avatar, wins, winHistory) {
        const globalAccountName = document.getElementById('globalAccountName');
        if (globalAccountName) globalAccountName.innerText = name;
    }

    async function syncNameToCurrentRoom(newName, bestAvatar) {
        if (!state.currentRoom || !state.currentPlayerId) return;
        try {
            const pRef = ref(db, `rooms/${state.currentRoom}/players/${state.currentPlayerId}`);
            const pSnap = await get(pRef);
            if (pSnap.exists()) {
                await update(pRef, { name: newName, avatar: bestAvatar || null });
            }
        } catch (e) {
            console.error("Room sync error:", e);
        }
    }

    async function handleLogin(provider) {
        const modal = document.getElementById('accountModal');
        try {
            const user = auth.currentUser;
            if (user && user.isAnonymous) {
                await linkWithPopup(user, provider);
                showToast("Account linked! Your stats are saved.", false, 3000, true);
            } else {
                await signInWithPopup(auth, provider);
            }
        } catch (e) {
            if (e.code === 'auth/credential-already-in-use') {
                try {
                    const credential = provider.providerId === 'google.com' 
                        ? GoogleAuthProvider.credentialFromError(e) 
                        : OAuthProvider.credentialFromError(e);
                    
                    if (credential) {
                        await signInWithCredential(auth, credential);
                        showToast("Logged into existing account.", false, 3000, true);
                    } else {
                        showToast("Account already exists. Please sign out of guest to log in.", true);
                    }
                } catch (err) {
                    if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
                        showToast("Login failed: " + err.message, true);
                    }
                }
            } else if (e.code === 'auth/popup-blocked') {
                showToast("Popup blocked! Please allow popups for this site.", true);
            } else if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
                showToast("Login failed: " + e.message, true);
            }
        } finally {
            if (modal) {
                modal.classList.remove('show');
                setTimeout(() => modal.style.display = 'none', 300);
            }
        }
    }

    function setupUIEventListeners() {
        const saveNickBtn = document.getElementById('saveNicknameBtn');
        if (saveNickBtn) {
            saveNickBtn.onclick = async () => {
                playSound('sfx-click');
                const nickInput = document.getElementById('customNicknameInput');
                if (!nickInput) return;
                
                const newName = nickInput.value.trim();
                if (!newName) return showToast("Display name cannot be empty.", true);
                
                if (state.currentPlayerId && auth.currentUser && !auth.currentUser.isAnonymous) {
                    saveNickBtn.innerText = "Saving...";
                    saveNickBtn.disabled = true;
                    try {
                        await update(ref(db, `users/${auth.currentUser.uid}/profile`), { nickname: newName });
                        showToast("Display name updated!", false, 3000, true);
                    } catch (e) {
                        showToast("Error updating name: " + e.message, true);
                    } finally {
                        saveNickBtn.innerText = "Save";
                        saveNickBtn.disabled = false;
                    }
                }
            };
        }

        const loginGoogleBtn = document.getElementById('loginGoogleBtn');
        if (loginGoogleBtn) {
            loginGoogleBtn.onclick = () => {
                playSound('sfx-click');
                handleLogin(googleProvider);
            };
        }

        const loginDiscordBtn = document.getElementById('loginDiscordBtn');
        if (loginDiscordBtn) {
            loginDiscordBtn.onclick = () => {
                playSound('sfx-click');
                handleLogin(discordProvider);
            };
        }

        const signOutBtn = document.getElementById('signOutBtn');
        if (signOutBtn) {
            signOutBtn.onclick = async () => {
                playSound('sfx-click');
                await signOut(auth);
                window.location.reload();
            };
        }
    }
    
    setupUIEventListeners();

    async function requestPushPermissions(uid, silent = false) {
        try {
            if (!('Notification' in window)) {
                if (!silent) showToast("Push not supported here.", true);
                return;
            }

            let permission = Notification.permission;
            if (permission === 'default' && !silent) permission = await Notification.requestPermission();

            if (permission === 'granted') {
                const supported = await isSupported();
                if (!supported) {
                    if (!silent) showToast("Push notifications are not supported in this browser.", true);
                    return;
                }

                const messaging = getMessaging(app);
                const swRegistration = await navigator.serviceWorker.getRegistration();

                const token = await getToken(messaging, { vapidKey: 'BMk1hzKGyWMBxOCWrSPB2-xb3zF5BakEb4kU5_Gq2_gSsDaZZ3hJ9rhcNkj43sxsItODXdq-2Rph-XhcAl2EFVA', serviceWorkerRegistration: swRegistration });
                
                if (token) {
                    await update(ref(db, `users/${uid}/fcmTokens`), { [token]: 'web' });
                    if (!silent) showToast("Push Notifications synced!", false, 3000, true);
                    
                    onMessage(messaging, (payload) => {
                        showToast(`🔔 ${payload.notification?.title}: ${payload.notification?.body}`, false, 5000, true);
                    });
                } else {
                    if (!silent) showToast("Failed to generate notification token.", true);
                }
            } else {
                if (!silent) showToast("Notification permission denied.", true);
            }
        } catch (error) {
            console.error('FCM Error:', error); 
            if (!silent) showToast("Failed to enable notifications.", true);
        }
    }
}