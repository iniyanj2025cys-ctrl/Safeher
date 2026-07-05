// ═══════════════════════════════════════════════════════
//  config.js — SafeHer Firebase Configuration
//  ⚠️  REPLACE the values below with YOUR Firebase project
//  Go to: Firebase Console → Project Settings → Your Apps
// ═══════════════════════════════════════════════════════

const firebaseConfig = {
  apiKey: "AIzaSyDrIm9fyKKMGsri8U6PJ3nh7Etp-cB07p8",
  authDomain: "safeher-app-ebd6e.firebaseapp.com",
  projectId:process.env.FIREBASE_PROJECT_ID,
  storageBucket: "safeher-app-ebd6e.firebasestorage.app",
  messagingSenderId: "815594120308",
  appId: "1:815594120308:web:f0acddd85edb2895f25d21"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Global handles used across ALL pages
const auth = firebase.auth();
const db   = firebase.firestore();

// ── Enable offline persistence (PWA support) ──
db.enablePersistence({ synchronizeTabs: true }).catch(() => {});