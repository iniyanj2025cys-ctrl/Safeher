<div align="center">

# 🛡️ Safe<span style="color:#c84b9e">Her</span>

### **An Offline-First, AI-Powered Women's Safety Progressive Web App**

*Voice-Activated SOS • Intelligent Risk Analysis • Live Journey Monitoring • Secure Evidence Vault*

[![PWA](https://img.shields.io/badge/PWA-Installable-c84b9e?style=for-the-badge)](#)
[![Firebase](https://img.shields.io/badge/Backend-Firebase-ffca28?style=for-the-badge&logo=firebase)](#)
[![JavaScript](https://img.shields.io/badge/Frontend-Vanilla%20JS-f7df1e?style=for-the-badge&logo=javascript&logoColor=black)](#)
[![Security](https://img.shields.io/badge/Security-AES--256%20%7C%20SHA--256-22c97a?style=for-the-badge)](#)
[![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](#)


</div>

---

# 📌 Overview

**SafeHer** is an **offline-first Progressive Web App (PWA)** designed to improve women's safety through intelligent journey monitoring, voice-activated emergency assistance, community-driven risk mapping, and secure evidence management.

Unlike traditional panic-button applications, SafeHer continuously analyzes the user's journey, predicts unsafe areas using community-generated reports, detects unexpected route deviations, and automatically escalates emergencies—even when the user cannot interact with the device.

The application is built using a **client-heavy architecture**, allowing most computations—including danger-zone analysis—to execute directly on the user's device while Firebase provides authentication, cloud synchronization, and real-time data sharing.

---

# 🌟 Key Features

## 🗺️ Intelligent Journey Tracking

- Live journey tracking with destination and ETA.
- Share journey details instantly with emergency contacts.
- Route safety analysis before starting a journey.
- Continuous monitoring throughout the trip.
- Automatic route deviation detection.
- Countdown safety confirmation dialog.
- Automatic SOS if the user does not respond.
- Manual **Arrived** and **+5 Minutes** controls.
- Live journey history.

---

## 🧠 AI-Powered Risk Engine

SafeHer uses a custom-built **Risk Engine** to transform community reports into meaningful danger zones without requiring labeled datasets.

### Features

- DBSCAN clustering using Haversine distance.
- Automatic danger-zone generation.
- Time-aware risk scoring.
- Exponential report decay (21-day half-life).
- Gaussian time-of-day weighting.
- Distance-based route risk analysis.
- Priority ranking of nearby danger zones.
- Admin-verified danger zones merged with community-generated zones.

---

## 📍 Community Safety Map

- Interactive map using Leaflet.
- Community incident reporting.
- Heatmap visualization using Leaflet.heat.
- Report:
  - Poor lighting
  - Harassment
  - Suspicious activity
  - Isolated roads
  - Unsafe locations
- Cross-user Firestore synchronization.

---

## 🆘 Smart SOS System

Multiple emergency activation methods:

### Voice SOS

- Hands-free emergency activation.
- Voice distress detection.
- Works immediately after login.

### Pattern Lock

- Secondary authentication.
- Duress-aware unlock mechanism.

### Emergency Broadcast

- Live location sharing.
- Instant notification to emergency contacts.
- Automatic escalation during journey deviations.

---

## 📂 Evidence & Incident Toolkit

Store evidence securely inside the application.

Supports:

- Images
- Audio recordings
- Documents

Features:

- Timestamped evidence
- SHA-256 integrity verification
- FIR draft generator
- Fake Call simulation
- Guided incident reporting

---

## 📅 Routine Safety Check-ins

Users can configure recurring checkpoints such as:

- Left Home
- Reached Office
- Leaving Office
- Home Safe

If a scheduled check-in is missed, emergency contacts are notified automatically.

---

## 🔒 Security Features

SafeHer follows a security-first architecture.

### Data Protection

- AES-256 encryption using CryptoJS
- Client-side encryption before Firestore upload
- Encrypted emergency contacts
- Encrypted profile information

### Integrity

- SHA-256 hashing
- Pattern lock hashing
- Evidence integrity verification

### Authentication

- Firebase Authentication
- Email/Password authentication
- Automatic session restoration

### Database Security

- Firestore Security Rules
- User-scoped document access
- Controlled public heatmap access

---

## 📱 Progressive Web App

SafeHer works like a native application while remaining browser-based.

Features include:

- Installable
- Offline support
- Service Worker caching
- Firestore offline persistence
- Home screen shortcuts
- Voice SOS shortcut
- Fast loading
- Cross-platform compatibility

---

# 🏗️ System Architecture

```
                User

                  │

        Progressive Web App

                  │

     ┌────────────┼─────────────┐
     │            │             │

 Journey      Risk Engine     SOS Module

     │            │             │

 Community Reports      Voice Detection

     │            │             │

      Firebase Authentication

                  │

            Cloud Firestore

                  │

    Emergency Contacts & Heatmap
```

---

# ⚙️ Technical Highlights

- Offline-first architecture
- Progressive Web App
- Client-side machine learning
- DBSCAN clustering
- Gaussian time-aware weighting
- Exponential report decay
- Journey deviation detection
- Live route-risk analysis
- AES-256 encryption
- SHA-256 hashing
- Firestore offline persistence

---

# 🛠️ Technology Stack

| Layer | Technology |
|--------|------------|
| Frontend | HTML5, CSS3, Vanilla JavaScript |
| Maps | Leaflet.js, Leaflet.heat |
| Routing | OSRM |
| Backend | Firebase Authentication |
| Database | Cloud Firestore |
| Security | CryptoJS |
| Machine Learning | Custom DBSCAN Risk Engine |
| Notifications | EmailJS |
| PWA | Service Worker, Manifest |

---

# 📂 Project Structure

```text
SafeHer/
│
├── index.html                  # Login Page
├── register.html               # User Registration & Emergency Contacts
├── home.html                   # Dashboard
├── journey.html                # Journey Tracking Interface
├── journey.js                  # Journey Monitoring & Deviation Detection
├── map.html                    # Community Safety Map
├── sos.html                    # Voice Detection & SOS
├── routine.html                # Daily Safety Check-ins
├── fin.html                    # Evidence Vault, FIR Generator & Fake Call
│
├── auth.js                     # Authentication & Encryption Helpers
├── config.js                   # Firebase Configuration
├── risk-engine.js              # DBSCAN Clustering & Risk Scoring
│
├── pwa.js                      # PWA Installation Logic
├── sw.js                       # Service Worker
├── manifest.json               # Web App Manifest
│
├── firebase.json               # Firebase Hosting Configuration
├── firestore.rules             # Firestore Security Rules
├── .firebaserc                 # Firebase Project Alias
├── .firebaseignore             # Firebase Deployment Ignore List
├── .gitignore                  # Git Ignore Rules
├── 404.html                    # Custom Firebase 404 Page
│
├── assets/                     # Images, Icons & Media
├── README.md
└── LICENSE
```
---

# 🚀 Installation

## Clone Repository

```bash
git clone https://github.com/NeethutBiju/SafeHer.git
cd SafeHer
```

---

## Configure Firebase

Create a Firebase project and enable:

- Firebase Authentication
- Cloud Firestore

Replace the configuration inside `config.js`.

```javascript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "...",
  appId: "..."
};
```

---

## Deploy Firestore Rules

Deploy the Firestore security rules.

```bash
firebase deploy --only firestore:rules
```

---

## Run Locally

```bash
firebase serve
```

or

```bash
npx serve .
```

---

## Deploy

```bash
firebase deploy
```

---

# 🔐 Security Considerations

> **Development Notice**

The encryption key inside `auth.js` is intended only for development.

For production deployments:

- Store encryption keys securely.
- Use environment variables or a secrets manager.
- Enable Firebase App Check.
- Consider server-side encryption for highly sensitive information.

---

# 🛣️ Future Enhancements

- Push Notifications
- Server-side encryption key management
- Multi-language voice recognition
- AI-powered emergency speech detection
- Admin moderation dashboard
- Analytics dashboard
- Predictive crime trend analysis

---

# 🤝 Contributing

Contributions are welcome.

If you discover a security issue, please disclose it privately instead of creating a public issue.

---

<div align="center">

### Built with 💜 to make every journey safer.

**If you found this project helpful, consider giving it a ⭐ on GitHub!**

</div>
