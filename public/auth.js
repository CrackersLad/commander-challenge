import { app, db, auth, googleProvider, discordProvider } from './firebase-setup.js?v=19.54';
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

            if (window.Capacitor && window.Capacitor.Plugins.PushNotifications) {
                window.Capacitor.Plugins.PushNotifications.checkPermissions().then(status => {
                    updateUIState(status.receive);
                    if (status.receive === 'granted') requestPushPermissions(uid, true);
                });
            } else if ('Notification' in window) {
                updateUIState(Notification.permission);
                if (Notification.permission === 'granted') requestPushPermissions(uid, true);
            } else {
                const isNative = window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() !== 'web';
                if (isNative) {
                    enableNotificationsBtn.innerText = '❌ Push Plugin Missing';
                    enableNotificationsBtn.style.opacity = '0.7';
                    enableNotificationsBtn.onclick = () => {
                        playSound('sfx-click');
                        showToast("Developer Error: @capacitor/push-notifications is not installed or synced.", true, 6000);
                    };
                    return;
                }
                enableNotificationsBtn.innerText = '📱 App Install Required for Push';
                enableNotificationsBtn.style.opacity = '0.7';
                enableNotificationsBtn.onclick = () => {
                    playSound('sfx-click');
                    showToast("To enable notifications on iOS Safari, tap 'Share' then 'Add to Home Screen'.", false, 6000, true);
                };
                return;
            }
            enableNotificationsBtn.onclick = async () => {
                playSound('sfx-click');
                if (enableNotificationsBtn.innerText.includes('Blocked')) {
                    showToast("Blocked by OS. Please open device Settings to allow notifications.", true, 4000);
                    return;
                }
                await requestPushPermissions(uid);
                if (window.Capacitor && window.Capacitor.Plugins.PushNotifications) {
                    const st = await window.Capacitor.Plugins.PushNotifications.checkPermissions();
                    updateUIState(st.receive);
                } else if ('Notification' in window) {
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
            
            const nickInput = document.getElementById('customNicknameInput');
            if (nickInput && document.activeElement !== nickInput) nickInput.value = finalName;
            
            const globalAccountName = document.getElementById('globalAccountName');
            if (globalAccountName) globalAccountName.innerText = finalName;

            if (finalName && finalName !== "Player") {
                state.currentPlayerName = finalName;
                localStorage.setItem('playerName', finalName);
                const playerNameInput = document.getElementById('playerNameInput');
                if (playerNameInput && document.activeElement !== playerNameInput) {
                    playerNameInput.value = finalName;
                }
            }

            await syncRoomsWithIdentity(finalName, bestAvatar, uid);
        }, (err) => console.warn("Profile read skipped:", err.message));
    }

    async function syncRoomsWithIdentity(finalName, avatar, uid) {
        try {
            if (!state.currentPlayerId) return;

            let roomsToUpdate = [];
            const savedRooms = localStorage.getItem('joinedRooms');
            if (savedRooms) {
                roomsToUpdate = JSON.parse(savedRooms);
            } else if (state.currentRoom) {
                roomsToUpdate = [state.currentRoom];
            }

            if (roomsToUpdate.length === 0) {
                if (document.getElementById('view-landing').classList.contains('active')) window.loadMyPlaygroups();
                return;
            }

            // Create a single multi-path update payload for the root level
            const rootUpdates = {};
            const gName = localStorage.getItem('guestName') || finalName || "Player";
            
            roomsToUpdate.forEach(code => {
                const pathPrefix = `rooms/${code}/players/${state.currentPlayerId}`;
                rootUpdates[`${pathPrefix}/name`] = uid ? finalName : gName;
                rootUpdates[`${pathPrefix}/avatar`] = avatar || null;
                rootUpdates[`${pathPrefix}/uid`] = uid || null;
                if (uid) rootUpdates[`${pathPrefix}/guestName`] = gName;
            });
            
            // Send the entire batch at once without downloading any room data!
            if (Object.keys(rootUpdates).length > 0) {
                await update(ref(db), rootUpdates);
            }

            if (document.getElementById('view-landing').classList.contains('active')) {
                window.loadMyPlaygroups();
            }
        } catch (e) {
            console.error("Room sync error:", e);
        }
    }

    async function handleLogin(provider) {
        const modal = document.getElementById('accountModal');
        try {
            const user = auth.currentUser;
            const isMobileDevice = /android|iphone|ipad|ipod/i.test(navigator.userAgent.toLowerCase());

            if (isMobileDevice) {
                if (!window.Capacitor || !window.Capacitor.Plugins || !window.Capacitor.Plugins.FirebaseAuthentication) {
                    alert("CRITICAL ERROR: Native plugins failed to load.\nPlease close Android Studio, run 'npx cap sync android' in PowerShell, and rebuild.");
                    return;
                }

                if (provider.providerId === 'google.com') {
                    let result;
                    try {
                        result = await window.Capacitor.Plugins.FirebaseAuthentication.signInWithGoogle({
                            clientId: "579721236208-53ml1vqsosjb4cglpo3etka31l1f8l1e.apps.googleusercontent.com",
                            clientId: "579721236208-53ml1vqsosjb4cglpo3etka31l1f8l1e.apps.googleusercontent.com",
                            serverClientId: "579721236208-53ml1vqsosjb4cglpo3etka31l1f8l1e.apps.googleusercontent.com"
                        });
                    } catch (nativeErr) {
                        console.error("Native Auth Error:", nativeErr);
                        // Silently ignore if the user just closed the login popup
                        if (!String(nativeErr.message).toLowerCase().includes("cancel")) {
                            showToast("Google Sign-In failed.", true);
                        }
                        return;
                    }

                    if (!result || !result.credential || !result.credential.idToken) {
                        alert("Error: Google Sign-In succeeded but returned no ID Token.");
                        return;
                    }

                    let credential;
                    try {
                        credential = GoogleAuthProvider.credential(result.credential.idToken);
                        if (user && user.isAnonymous) {
                            await linkWithCredential(user, credential);
                            showToast("Account linked! Your stats are saved.", false, 3000, true);
                        } else {
                            await signInWithCredential(auth, credential);
                        }
                    } catch (fbErr) {
                        if (fbErr.code === 'auth/credential-already-in-use' && credential) {
                            try {
                                await signInWithCredential(auth, credential);
                                showToast("Logged into existing account.", false, 3000, true);
                            } catch (signInErr) {
                                alert("Login Error: " + (signInErr.message || JSON.stringify(signInErr)));
                            }
                        } else {
                            alert("Firebase Error: " + (fbErr.message || JSON.stringify(fbErr)));
                        }
                    }
                } else {
                    if (user && user.isAnonymous) {
                        await linkWithRedirect(user, provider);
                    } else {
                        await signInWithRedirect(auth, provider);
                    }
                }
                return; // STOPS execution to physically prevent the browser redirect
            }

            // Web fallback (Desktop only)
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
                        console.error("Save name error:", e);
                        showToast("Failed to update name: " + e.message, true);
                    } finally {
                        saveNickBtn.innerText = "Save";
                        saveNickBtn.disabled = false;
                    }
                }
            };
        }

        const loginBtn = document.getElementById('loginGoogleBtn');
        if (loginBtn) loginBtn.onclick = () => handleLogin(googleProvider);
        
        const loginDiscordBtn = document.getElementById('loginDiscordBtn');
        if (loginDiscordBtn) loginDiscordBtn.onclick = () => handleLogin(discordProvider);

        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.onclick = () => {
                playSound('sfx-click');
                window.isExplicitSignOut = true;
                signOut(auth).then(() => {
                    const modal = document.getElementById('accountModal');
                    if (modal) {
                        modal.classList.remove('show');
                        setTimeout(() => modal.style.display = 'none', 300);
                    }
                    showToast("Reverted to Guest Mode.", false, 3000, true);
                });
            };
        }
    }
    
    setupUIEventListeners();

    async function requestPushPermissions(uid, silent = false) {
        try {
            if (window.Capacitor && window.Capacitor.Plugins.PushNotifications) {
                const PushNotifications = window.Capacitor.Plugins.PushNotifications;
                let permStatus = await PushNotifications.checkPermissions();
                if (permStatus.receive === 'prompt') {
                    if (silent) return;
                    permStatus = await PushNotifications.requestPermissions();
                }
                if (permStatus.receive !== 'granted') {
                    if (!silent) showToast("Notification permission denied.", true);
                    return;
                }
                
                await PushNotifications.removeAllListeners();

                if (window.Capacitor.getPlatform() === 'android') {
                    try {
                        await PushNotifications.createChannel({
                            id: 'default',
                            name: 'General Alerts',
                            description: 'Notifications for challenge events',
                            importance: 5,
                            visibility: 1
                        });
                    } catch(e) { console.warn("Channel init error:", e); }
                }

                PushNotifications.addListener('registration', async (token) => {
                    const platform = window.Capacitor ? window.Capacitor.getPlatform() : 'mobile';
                    await update(ref(db, `users/${uid}/fcmTokens`), { [token.value]: platform });
                    if (!silent) showToast("Push Notifications synced!", false, 3000, true);
                    const btn = document.getElementById('enableNotificationsBtn');
                    if (btn) {
                        btn.innerHTML = '✅ Notifications Enabled <span style="font-size:0.8em; opacity:0.8;">(Tap to re-sync)</span>';
                        btn.disabled = false;
                        btn.style.opacity = '1';
                    }
                });
                PushNotifications.addListener('registrationError', (error) => {
                    if (!silent) showToast("Failed to generate native token.", true);
                });
                PushNotifications.addListener('pushNotificationReceived', (notification) => {
                    showToast(`🔔 ${notification.title}: ${notification.body}`, false, 5000, true);
                });
                PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
                    const data = action.notification.data;
                    if (data && data.url) window.location.href = data.url;
                });
                
                await PushNotifications.register();
                return;
            }

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

                // NOTE: You must generate a VAPID key in the Firebase Console (Project Settings > Cloud Messaging > Web configuration)
                // Replace 'YOUR_VAPID_KEY_HERE' below with your actual key.
                const token = await getToken(messaging, { vapidKey: 'BMk1hzKGyWMBxOCWrSPB2-xb3zF5BakEb4kU5_Gq2_gSsDaZZ3hJ9rhcNkj43sxsItODXdq-2Rph-XhcAl2EFVA', serviceWorkerRegistration: swRegistration });
                
                if (token) {
                    await update(ref(db, `users/${uid}/fcmTokens`), { [token]: 'web' });
                    if (!silent) showToast("Push Notifications synced!", false, 3000, true);
                    const btn = document.getElementById('enableNotificationsBtn');
                    if (btn) {
                        btn.innerHTML = '✅ Notifications Enabled <span style="font-size:0.8em; opacity:0.8;">(Tap to re-sync)</span>';
                        btn.disabled = false;
                        btn.style.opacity = '1';
                    }
                    
                    // Listen for foreground messages (when user has the app open)
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