import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-functions.js";
import { getAuth, GoogleAuthProvider, OAuthProvider } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";

export const firebaseConfig = {
  apiKey: "AIzaSyAgz3iXNpyrBuLF_v2dl1LkcpAzF24j7so",
  authDomain: "commander-challenge.firebaseapp.com",
  databaseURL: "https://commander-challenge-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "commander-challenge",
  storageBucket: "commander-challenge.firebasestorage.app",
  messagingSenderId: "579721236208",
  appId: "1:579721236208:web:fe4b4de3bb543734bf7c35"
};

export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const functions = getFunctions(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const discordProvider = new OAuthProvider('oidc.discord');
discordProvider.addScope('identify');
discordProvider.addScope('email');