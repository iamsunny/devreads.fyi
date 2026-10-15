import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, reauthenticateWithPopup, signOut as firebaseSignOut, onIdTokenChanged } from 'firebase/auth';

let auth;
let previousUID;
export async function configure(config) {
  if (!auth) {
    auth = getAuth(initializeApp(config));
    onIdTokenChanged(auth, user => {
      const uid = user?.uid || null;
      if (previousUID !== undefined && previousUID !== uid) window.dispatchEvent(new CustomEvent('devreads:firebase-session', {detail:{uid}}));
      previousUID = uid;
    });
  }
  await auth.authStateReady();
}
function provider() {
  const google = new GoogleAuthProvider();
  google.setCustomParameters({prompt:'select_account'});
  return google;
}
export async function token() { return auth.currentUser ? auth.currentUser.getIdToken() : null; }
export async function signInGoogle() { return signInWithPopup(auth, provider()); }
export async function reauthenticateGoogle() {
  if (!auth.currentUser) throw new Error('Please sign in with Google first.');
  await reauthenticateWithPopup(auth.currentUser, provider());
  await auth.currentUser.getIdToken(true);
}
export async function signOut() { await firebaseSignOut(auth); }
