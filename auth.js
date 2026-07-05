// ═══════════════════════════════════════════════════════
//  auth.js — SafeHer Shared Auth & Utility Functions
//  Loaded by: index.html, register.html, home.html,
//             sos.html, journey.html, map.html,
//             report.html, fakecall.html
// ═══════════════════════════════════════════════════════

// ── AES Encryption key (change this in production!) ──
const ENC_KEY = "SafeHer_AES_Secret_Key_2024!";

// ════════════════════════════════════════════
//  ENCRYPTION / HASHING
// ════════════════════════════════════════════

/** Encrypt any JS object → base64 string */
function encrypt(data) {
  return CryptoJS.AES.encrypt(JSON.stringify(data), ENC_KEY).toString();
}

/** Decrypt base64 string → JS object */
function decrypt(cipherText) {
  try {
    const bytes = CryptoJS.AES.decrypt(cipherText, ENC_KEY);
    return JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
  } catch {
    return null;
  }
}

/** SHA-256 hash a string → hex string */
function hashSHA256(str) {
  return CryptoJS.SHA256(str || "").toString();
}

// ════════════════════════════════════════════
//  SESSION MANAGEMENT
//  Stores minimal info in sessionStorage so
//  pages can read user data without extra
//  Firestore calls on every load.
// ════════════════════════════════════════════

/**
 * Call after successful login/register.
 * Saves name, uid, email, patternHash to sessionStorage.
 */
function saveSession(firebaseUser, profile) {
  sessionStorage.setItem("uid",         firebaseUser.uid);
  sessionStorage.setItem("userName",    profile.name  || firebaseUser.displayName || "");
  sessionStorage.setItem("userEmail",   profile.email || firebaseUser.email        || "");
  sessionStorage.setItem("userPhone",   profile.phone || "");
  // patternHash fetched separately after Firestore read
}

/** Read session value */
function getSession(key) {
  return sessionStorage.getItem(key);
}

/** Clear session on logout */
function clearSession() {
  sessionStorage.clear();
}

// ════════════════════════════════════════════
//  LOGIN
// ════════════════════════════════════════════

async function login() {
  const email    = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const btn      = document.getElementById("login-btn");
  const alertEl  = document.getElementById("login-alert");

  if (!email || !password)
    return showAlert(alertEl, "error", "Please enter your email and password.");

  setLoading(btn, true, "Signing in...");
  try {
    const cred = await auth.signInWithEmailAndPassword(email, password);

    // ── Fetch Firestore profile ──
    const snap = await db.collection("users").doc(cred.user.uid).get();
    const data = snap.data() || {};

    // Decrypt the encrypted profile blob
    let profile = {};
    if (data.profile) {
      profile = decrypt(data.profile) || {};
    }
    // Fallback: use plain fields if decryption fails
    profile.name  = profile.name  || cred.user.displayName || "";
    profile.email = profile.email || data.email            || cred.user.email;
    profile.phone = profile.phone || data.plainPhone       || "";

    // Save session
    saveSession(cred.user, profile);

    // ── Save patternHash to sessionStorage so sos.html can read it ──
    if (data.patternHash) {
      sessionStorage.setItem("patternHash", data.patternHash);
    }

    // ── Save emergency contacts to sessionStorage ──
    if (data.profile) {
      const dec = decrypt(data.profile);
      if (dec && dec.emergencyContacts) {
        sessionStorage.setItem("emergencyContacts", JSON.stringify(dec.emergencyContacts));
      }
    }

    showAlert(alertEl, "success", `✅ Welcome back, ${profile.name || "User"}!`);

    // ── Decide where to go ──
    // If user has never set a pattern → go to sos.html to set one
    // If user has a pattern → go to sos.html?mode=verify to verify
    // After verify, sos.html redirects to home.html
    setTimeout(() => {
      if (!data.patternHash) {
        window.location.href = "sos.html"; // first time: set pattern
      } else {
        window.location.href = "sos.html?mode=verify"; // returning: verify
      }
    }, 1200);

  } catch (err) {
    showAlert(alertEl, "error", friendlyError(err.code));
  } finally {
    setLoading(btn, false, "Sign In Securely");
  }
}

// ════════════════════════════════════════════
//  FORGOT PASSWORD
// ════════════════════════════════════════════

async function forgotPassword() {
  const email = document.getElementById("login-email").value.trim();
  const alertEl = document.getElementById("login-alert");
  if (!email) return showAlert(alertEl, "error", "Enter your email above first.");
  try {
    await auth.sendPasswordResetEmail(email);
    showAlert(alertEl, "success", "✅ Password reset email sent!");
  } catch (err) {
    showAlert(alertEl, "error", friendlyError(err.code));
  }
}

// ════════════════════════════════════════════
//  LOGOUT  (call from any page)
// ════════════════════════════════════════════

async function logout() {
  clearSession();
  await auth.signOut();
  window.location.href = "index.html";
}

// ════════════════════════════════════════════
//  UI HELPERS
// ════════════════════════════════════════════

/**
 * Show / hide an alert div.
 * @param {HTMLElement} el   - the .alert div
 * @param {"error"|"success"} type
 * @param {string} msg
 */
function showAlert(el, type, msg) {
  if (!el) return;
  el.className = `alert ${type} show`;
  el.textContent = msg;
  // Auto-hide success after 4s
  if (type === "success") setTimeout(() => el.classList.remove("show"), 4000);
}

/**
 * Put a button into loading / normal state.
 * @param {HTMLButtonElement} btn
 * @param {boolean} loading
 * @param {string} label  - text when NOT loading
 */
function setLoading(btn, loading, label) {
  if (!btn) return;
  btn.disabled = loading;
  btn.textContent = loading ? "Please wait..." : label;
}

/**
 * Toggle password field visibility.
 * @param {string} inputId
 * @param {HTMLButtonElement} toggleBtn
 */
function togglePw(inputId, toggleBtn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const isHidden = input.type === "password";
  input.type = isHidden ? "text" : "password";
  toggleBtn.textContent = isHidden ? "🙈" : "👁";
}

// ════════════════════════════════════════════
//  PASSWORD STRENGTH CHECKER
// ════════════════════════════════════════════

function checkStrength(val) {
  const wrap  = document.getElementById("strength-wrap");
  const fill  = document.getElementById("strength-fill");
  const label = document.getElementById("strength-label");
  if (!wrap || !fill || !label) return;

  if (!val) { wrap.classList.remove("show"); return; }
  wrap.classList.add("show");

  let score = 0;
  if (val.length >= 8)               score++;
  if (/[A-Z]/.test(val))             score++;
  if (/[0-9]/.test(val))             score++;
  if (/[^A-Za-z0-9]/.test(val))      score++;

  const levels = [
    { pct: "25%",  color: "#E74C3C", text: "Weak" },
    { pct: "50%",  color: "#F39C12", text: "Fair" },
    { pct: "75%",  color: "#3498DB", text: "Good" },
    { pct: "100%", color: "#00e5a0", text: "Strong ✅" },
  ];
  const l = levels[score - 1] || levels[0];
  fill.style.width      = l.pct;
  fill.style.background = l.color;
  label.textContent     = l.text;
  label.style.color     = l.color;
}

// ════════════════════════════════════════════
//  FRIENDLY FIREBASE ERROR MESSAGES
// ════════════════════════════════════════════

function friendlyError(code) {
  const map = {
    "auth/user-not-found":        "No account found with this email.",
    "auth/wrong-password":        "Incorrect password. Try again.",
    "auth/invalid-email":         "Please enter a valid email address.",
    "auth/email-already-in-use":  "This email is already registered.",
    "auth/weak-password":         "Password is too weak (min 8 characters).",
    "auth/too-many-requests":     "Too many attempts. Try again later.",
    "auth/network-request-failed":"Network error. Check your connection.",
    "auth/invalid-credential":    "Invalid email or password.",
  };
  return map[code] || "Something went wrong. Please try again.";
}

// ════════════════════════════════════════════
//  AUTH GUARD  (call at top of protected pages)
//  Usage: requireAuth().then(user => { ... })
// ════════════════════════════════════════════

function requireAuth() {
  return new Promise((resolve, reject) => {
    const unsub = auth.onAuthStateChanged(user => {
      unsub();
      if (user) {
        resolve(user);
      } else {
        window.location.href = "index.html";
        reject("not-logged-in");
      }
    });
  });
}