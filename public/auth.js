import { app, db, auth, googleProvider, discordProvider } from './firebase-setup.js?v=19.39';
import { ref, get, update, onValue } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";
import { signInWithPopup, signOut, onAuthStateChanged, signInAnonymously, linkWithPopup, signInWithCredential, GoogleAuthProvider, OAuthProvider, linkWithCredential } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { getMessaging, getToken, onMessage, isSupported } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging.js";

export function initAuthModule(utils, state) {
    const { playSound, showToast } = utils;

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

        const isDiscord = !!discordData;
        const providerStr = isDiscord ? 'Discord' : (googleData ? 'Google' : 'Unknown');

        updateAuthUI(true, bestName, bestAvatar, providerStr);
        
        update(ref(db, `users/${user.uid}/profile`), { provider: providerStr })
            .catch(e => console.warn("Could not save provider:", e));

        if (!localStorage.getItem('guestName') && state.currentPlayerName) {
            localStorage.setItem('guestName', state.currentPlayerName);
        }

        setupNotificationButton(user.uid);
        listenToUserProfile(user.uid, bestName, bestAvatar);
    }

    async function handleGuestUser(user) {
        if (state.activeUserProfileListener) {
            state.activeUserProfileListener();
            state.activeUserProfileListener = null;
        }
        
        updateAuthUI(false);

        const savedGuestName = localStorage.getItem('guestName') || localStorage.getItem('playerName');
        if (savedGuestName) {
            state.currentPlayerName = savedGuestName;
            localStorage.setItem('guestName', savedGuestName);
            localStorage.setItem('playerName', savedGuestName);
            const playerNameInput = document.getElementById('playerNameInput');
            if (playerNameInput) playerNameInput.value = savedGuestName;
        }

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
            if (globalAccountName) globalAccountName.innerText = "Guest";
            if (globalAvatar) globalAvatar.style.display = 'none';
            state.currentPlayerAvatar = null;
            localStorage.removeItem('playerAvatar');
        }
    }

    function setupNotificationButton(uid) {
        const enableNotificationsBtn = document.getElementById('enableNotificationsBtn');
        if (enableNotificationsBtn) {
            enableNotificationsBtn.style.display = Notification.permission === 'default' ? 'block' : 'none';
            enableNotificationsBtn.onclick = () => {
                playSound('sfx-click');
                requestPushPermissions(uid);
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
                        result = await window.Capacitor.Plugins.FirebaseAuthentication.signInWithGoogle();
                    } catch (nativeErr) {
                        alert("Native Plugin Error: " + (nativeErr.message || JSON.stringify(nativeErr)));
                        return;
                    }

                    if (!result || !result.credential || !result.credential.idToken) {
                        alert("Error: Google Sign-In succeeded but returned no ID Token.");
                        return;
                    }

                    try {
                        const credential = GoogleAuthProvider.credential(result.credential.idToken);
                        if (user && user.isAnonymous) {
                            await linkWithCredential(user, credential);
                            showToast("Account linked! Your stats are saved.", false, 3000, true);
                        } else {
                            await signInWithCredential(auth, credential);
                        }
                    } catch (fbErr) {
                        alert("Firebase Error: " + (fbErr.message || JSON.stringify(fbErr)));
                    }
                } else {
                    showToast("Only Google Sign-In is supported on the mobile app.", true);
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