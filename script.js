import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, push, set, onValue, remove, serverTimestamp, runTransaction, increment, get, update } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { getStorage, ref as sRef, deleteObject, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { 
    getAuth, 
    signInAnonymously, 
    onAuthStateChanged, 
    linkWithCredential,
    linkWithPopup,                  // <-- Needed for Google conversion
    signInWithPopup,                // <-- Needed for Google login
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    sendEmailVerification,
    EmailAuthProvider,
    GoogleAuthProvider,             // <-- ADD THIS IMPORT
    deleteUser,                   // <-- ADD THIS    
    setPersistence,
    indexedDBLocalPersistence,
    signOut 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
// 1. CONFIG
const firebaseConfig = {
    apiKey: "AIzaSyBEqSRropOTPGYJ7CCG6sbpo_C7chn1VL4",
    authDomain: "pulse-c8f1c.firebaseapp.com",
    projectId: "pulse-c8f1c",
    databaseURL: "https://pulse-c8f1c-default-rtdb.europe-west1.firebasedatabase.app",
    storageBucket: "pulse-c8f1c.firebasestorage.app",
    messagingSenderId: "630573206217",
    appId: "1:630573206217:web:968925b634d45ac8e41b18"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const pulsesRef = ref(db, 'pulses');
const storage = getStorage(app);

// Initialize Firebase Auth
const auth = getAuth(app);
let currentUser = null; // Holds the current Firebase User object

// Force IndexedDB persistence so PWA state survives backgrounding
setPersistence(auth, indexedDBLocalPersistence).catch(err => console.error("Persistence error:", err));

// --- AUTOMATIC ANONYMOUS AUTHENTICATION & PROFILE SYNC ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        localStorage.setItem('pulse_user_id', user.uid);
        console.log("👤 User Authenticated:", user.uid, user.isAnonymous ? "(Anonymous)" : "(Permanent Account)");

        // Sync custom username & profile pic if permanent account
        if (!user.isAnonymous) {
            await syncUserProfileData(user);
        }

        updateProfileNavButton(user);
    } else {
        try {
            const userCredential = await signInAnonymously(auth);
            currentUser = userCredential.user;
            localStorage.setItem('pulse_user_id', currentUser.uid);
            console.log("🔑 Signed in anonymously with UID:", currentUser.uid);
            updateProfileNavButton(currentUser);
        } catch (error) {
            console.error("Error with anonymous authentication:", error);
        }
    }
});

// --- SAVE / LINK ANONYMOUS ACCOUNT TO GOOGLE ---
window.convertAccountWithGoogle = async function() {
    if (!auth.currentUser) return;

    const provider = new GoogleAuthProvider();
    // Prompt account selector every time
    provider.setCustomParameters({ prompt: 'select_account' });

    try {
        if (auth.currentUser.isAnonymous) {
            // Attempt to link current anonymous session to Google
            const result = await linkWithPopup(auth.currentUser, provider);
            console.log("✅ Account successfully linked:", result.user.uid);
            await handlePostAccountSetup(result.user);
        } else {
            alert("You are already signed in with a permanent account!");
        }
    } catch (error) {
        console.error("Account linking error:", error);

        // If the Google account already exists in Firebase Auth, switch to it directly
        if (error.code === 'auth/credential-already-in-use' || error.code === 'auth/email-already-in-use') {
            showAccountConflictModal(provider);
        } else if (error.code === 'auth/popup-blocked') {
            alert("Please allow popups for Safari in your iPhone Settings to complete sign in.");
        } else {
            alert("Failed to save account: " + error.message);
        }
    }
};

// --- MODAL TO SWITCH TO AN EXISTING GOOGLE ACCOUNT ---
function showAccountConflictModal(provider) {
    const conflictHtml = `
        <div style="padding: 24px 20px 20px 20px; text-align: center; font-family: -apple-system, BlinkMacSystemFont, sans-serif;">
            <div style="font-size: 32px; margin-bottom: 10px;">⚠️</div>
            <h3 style="margin: 0 0 8px 0; font-size: 16px; color: #0f172a;">Account Already Exists</h3>
            <p style="font-size: 13px; color: #64748b; line-height: 1.4; margin-bottom: 20px;">
                This Google account is already registered. Switch to your saved profile?
            </p>

            <button id="switchAccountDirectBtn" style="
                width: 100%;
                background: #4285F4;
                color: #ffffff;
                border: none;
                padding: 12px;
                border-radius: 10px;
                font-weight: 600;
                font-size: 14px;
                cursor: pointer;
                margin-bottom: 8px;
            ">
                Switch to Saved Account
            </button>

            <button onclick="document.getElementById('custom-app-modal')?.remove()" style="
                width: 100%;
                background: transparent;
                color: #64748b;
                border: none;
                padding: 8px;
                font-size: 13px;
                cursor: pointer;
            ">
                Cancel
            </button>
        </div>
    `;

    showCustomModal(conflictHtml);

    document.getElementById('switchAccountDirectBtn').onclick = async () => {
        try {
            // Sign in directly to the existing Google user session
            const result = await signInWithPopup(auth, provider);
            console.log("✅ Switched to existing Google account:", result.user.uid);
            
            await syncUserProfileData(result.user);
            document.getElementById('custom-app-modal')?.remove();
            updateProfileNavButton(result.user);

            if (typeof window.handleSortChange === 'function') {
                window.handleSortChange();
            }
            alert("Logged into your saved account!");
        } catch (err) {
            console.error("Switch account error:", err);
            alert("Failed to sign in: " + err.message);
        }
    };
}
// --- HELPER FOR POST-SIGNUP MANDATORY USERNAME ---
async function handlePostAccountSetup(user) {
    if (!user) return;

    // 1. Sync any existing database profile first
    await syncUserProfileData(user);

    let existingUsername = localStorage.getItem(`pulse_username_${user.uid}`);

    // 2. If no username exists in DB or cache, force custom username setup
    if (!existingUsername) {
        let chosenUsername = "";
        let isValid = false;

        while (!isValid) {
            chosenUsername = prompt("Account created! Please enter a unique username (3-20 characters, letters/numbers/underscores only):");

            if (chosenUsername === null) {
                alert("A custom username is required to complete profile setup.");
                continue;
            }

            chosenUsername = chosenUsername.trim();
            const validRegex = /^[a-zA-Z0-9_]{3,20}$/;

            if (!validRegex.test(chosenUsername)) {
                alert("Invalid format! Use 3–20 characters with only letters, numbers, or underscores.");
                continue;
            }

            const cleanHandle = chosenUsername.toLowerCase();
            const usernameRef = ref(db, `usernames/${cleanHandle}`);
            const snapshot = await get(usernameRef);

            if (snapshot.exists() && snapshot.val() !== user.uid) {
                alert(`"${chosenUsername}" is already taken. Please try another.`);
                continue;
            }

            const updates = {};
            updates[`usernames/${cleanHandle}`] = user.uid;
            updates[`users/${user.uid}/username`] = chosenUsername;
            updates[`users/${user.uid}/usernameKey`] = cleanHandle;
            updates[`users/${user.uid}/updatedAt`] = Date.now();

            await update(ref(db), updates);
            localStorage.setItem(`pulse_username_${user.uid}`, chosenUsername);
            isValid = true;
        }
    }

    // 3. UI Updates
    document.getElementById('custom-app-modal')?.remove();
    updateProfileNavButton(user);
    
    // Re-render feed if handleSortChange exists to reflect new username on posts
    if (typeof window.handleSortChange === 'function') {
        window.handleSortChange();
    }
}
// --- STATE ---
let allPosts = [];
let activeFeedIds = new Set(); // Tracks what is currently on the user's screen
let currentCategory = 'All';
let isReCentering = false;
const updateBtn = document.getElementById('updateFeedBtn');
let miniMap = null;
let miniMarker = null;
let postLatLng = null;
let addressTimeout;
// Add this at the very top of your script
let currentMediaFiles = [];
let isReordered = false;
// Global object to store Leaflet marker instances by their Pulse ID
let markersById = {};
let currentImageMode = 'portrait'; // Default state
let allFilteredPosts = []; // Stores the full list of valid posts
let currentSliceIndex = 0; // Tracks how many have been rendered
const SLICE_SIZE = 20;     // How many to load at once

const categoryMap = {
    "Food": ["General", "Café", "Happy Hour", "Food Truck", "Pop-Up Kitchen"],
    "Art": ["General", "Street Art", "Gallery", "Workshop", "Museum"],
    "Music": ["General", "Live Set", "Busker", "Club/DJ", "Jam Session"],
    "Urban": ["General", "Nightlife", "Hidden Gem", "Market", "Event"],
    "Community": ["General", "Freebie", "Lost & Found", "Transit", "Meetup"],
    "Nature": ["General", "Garden", "Park", "Wildlife", "Swim Spot"]
};

// IMMEDIATE CHECK: Prevent the flicker
(function() {
    const hasLocation = localStorage.getItem('lastLat') && localStorage.getItem('lastLng');
    const gate = document.getElementById('location-gate');
    
    // If we DON'T have a saved location, show the gate immediately
    if (!hasLocation && gate) {
        gate.style.display = 'flex';
    }
})();

// 2. MAP INITIALIZATION
const startLat = localStorage.getItem('lastLat') || 59.9111; 
const startLng = localStorage.getItem('lastLng') || 10.7503;

// Increased zoom from 13 to 14 for a tighter street-level view
const map = L.map('map', { 
    zoomControl: false,
    tap: false // Recommended for better mobile touch performance
}).setView([startLat, startLng], 14);

// Replace 'YOUR_STADIA_API_KEY' with the long string from your dashboard
const STADIA_API_KEY = '147dd6c7-d2c8-402f-b6d5-b15cea9e3973';
L.tileLayer(`https://tiles.stadiamaps.com/tiles/osm_bright/{z}/{x}/{y}{r}.png?api_key=${STADIA_API_KEY}`, {
    maxZoom: 20,
    crossOrigin: true,
}).addTo(map);

let markerGroup = L.markerClusterGroup({ 
    maxClusterRadius: 30, 
    disableClusteringAtZoom: 18 // Increased this so markers stay individual longer
});
map.addLayer(markerGroup);

// IMPORTANT: maxZoom here must match or exceed your setView zoom
// otherwise, locate() will zoom the map back out to 12.
map.locate({ 
    setView: true, 
    maxZoom: 14, 
    enableHighAccuracy: true,
    timeout: 10000 // Stop trying after 10 seconds to save battery
});

// PREVENT PINCH-TO-ZOOM ON MOBILE SAFARI (EXCEPT MAPS)
document.addEventListener('gesturestart', function (e) {
    // If the pinch gesture did not start inside a map container, block it
    if (!e.target.closest('#map') && !e.target.closest('.map-container')) {
        e.preventDefault();
    }
});

document.addEventListener('gesturechange', function (e) {
    if (!e.target.closest('#map') && !e.target.closest('.map-container')) {
        e.preventDefault();
    }
});

// PREVENT DOUBLE-TAP TO ZOOM ON FAST CLICKS
let lastTouchEnd = 0;
document.addEventListener('touchend', function (e) {
    const now = (new Date()).getTime();
    if (now - lastTouchEnd <= 300) {
        // Allow double tap inside map containers
        if (!e.target.closest('#map') && !e.target.closest('.map-container')) {
            e.preventDefault();
        }
    }
    lastTouchEnd = now;
}, false);

// --- AUTH USER ID HELPERS ---
const getPulseUserId = () => {
    // Falls back to Auth current user UID, or local cache during initial boot
    return auth.currentUser ? auth.currentUser.uid : (localStorage.getItem('pulse_user_id') || 'guest');
};

function getPulseHandle(userId) {
    if (!userId) return 'USR-GUEST';
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
        hash = userId.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hex = Math.abs(hash).toString(16).substring(0, 5).toUpperCase();
    return `USR-${hex}`;
}
// Returns: USR-4A2B, USR-F91E

// 3. CORE LOGIC
// NEW SIMPLIFIED FRONTEND LISTENER
onValue(pulsesRef, (snapshot) => {
    const loader = document.getElementById('loading-indicator');
    if (loader) loader.style.display = 'none';

    const data = snapshot.val();
    const newPostsArray = [];
    if (data) {
        Object.keys(data).forEach(id => {
            newPostsArray.push({ id, ...data[id] });
        });
    }

    const hasNewContent = newPostsArray.some(p => {
        const isBrandNew = !allPosts.some(oldP => oldP.id === p.id);
        if (!isBrandNew) return false;

        const matchesCategory = (currentCategory === 'All' || p.category === currentCategory);
        const bounds = map.getBounds();
        const matchesMap = bounds && bounds.contains([p.lat, p.lng]);
        
        const startTime = p.scheduledStartTime || p.createdAt;
        const isFuture = startTime > Date.now();
        const postType = isFuture ? 'Scheduled' : 'Live';
        const matchesStatus = activeStatusFilters[postType];

        return matchesCategory && matchesMap && matchesStatus;
    });

    allPosts = newPostsArray;
    refreshMapMarkers(allPosts);

    // --- UPDATED ALERT LOGIC ---
    // Only show alert if there's new content AND we aren't on the first load
    if (hasNewContent && activeFeedIds.size > 0) {
        if (typeof window.showNewPostAlert === 'function') {
            window.showNewPostAlert();
        }
    }

    const hasDeletions = Array.from(activeFeedIds).some(id => !newPostsArray.find(p => p.id === id));
    if (hasDeletions) {
        handleLiveDeletions(newPostsArray);
    }

    if (activeFeedIds.size === 0 && map.getBounds()) {
        window.handleSortChange(); 
    }
});
// Helper to grey out cards that were deleted from the DB
function handleLiveDeletions(latestData) {
    activeFeedIds.forEach(id => {
        const stillExists = latestData.find(p => p.id === id);
        if (!stillExists) {
            const card = document.getElementById(`post-${id}`);
            if (card && !card.classList.contains('post-deleted')) {
                card.classList.add('post-deleted');
                card.style.opacity = "0.45";
                card.style.filter = "grayscale(1)";
                card.style.pointerEvents = "none";
                
                // Target the pulse-timer parent container and swap it with EXPIRED
                const timerSpan = card.querySelector('.pulse-timer');
                if (timerSpan && timerSpan.parentElement) {
                    timerSpan.parentElement.outerHTML = `
                        <span class="expired-tag" style="color: #ca2727; font-size: 10px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase;">
                            EXPIRED
                        </span>`;
                }
            }
        }
    });
}

const MAX_DISTANCE = 10000;

// Toggle Popup visibility
window.toggleFilterMenu = function(e) {
    if (e) e.stopPropagation();
    const popup = document.getElementById('filterMenuPopup');
    if (popup) {
        popup.style.display = popup.style.display === 'none' ? 'block' : 'none';
    }
};

// Close popup when clicking anywhere outside it
document.addEventListener('click', function(e) {
    const popup = document.getElementById('filterMenuPopup');
    const filterBtn = document.getElementById('filterMenuBtn');
    if (popup && popup.style.display === 'block') {
        if (!popup.contains(e.target) && !filterBtn.contains(e.target)) {
            popup.style.display = 'none';
        }
    }
});
// Track the active sort state outside the handler
let currentActiveSort = 'time';

window.handleSortChange = function() {
    const selectedStatus = document.querySelector('input[name="statusFilterRadio"]:checked');
    const selectedSort = document.querySelector('input[name="sortByRadio"]:checked');
    const selectedPersonal = document.querySelector('input[name="personalFilterRadio"]:checked');
    
    let statusVal = selectedStatus ? selectedStatus.value : 'all';
    let sortVal = selectedSort ? selectedSort.value : 'time';
    const personalVal = selectedPersonal ? selectedPersonal.value : 'all';

    const setSortRadio = (val) => {
        const radio = document.querySelector(`input[name="sortByRadio"][value="${val}"]`);
        if (radio) radio.checked = true;
        sortVal = val;
    };

    const setStatusRadio = (val) => {
        const radio = document.querySelector(`input[name="statusFilterRadio"][value="${val}"]`);
        if (radio) radio.checked = true;
        statusVal = val;
    };

    // --- SNAP-BACK CONFLICT LOGIC ---
    if (typeof currentActiveSort !== 'undefined') {
        if (currentActiveSort === 'start' && statusVal !== 'scheduled') {
            setSortRadio('time');
        } else if (currentActiveSort === 'timeLeft' && statusVal !== 'live') {
            setSortRadio('time');
        } else if (sortVal === 'start') {
            setStatusRadio('scheduled');
        } else if (sortVal === 'timeLeft') {
            setStatusRadio('live');
        }
    }

    if (typeof currentActiveSort !== 'undefined') {
        currentActiveSort = sortVal;
    }

    // --- APPLY STATUS STATE ---
    if (statusVal === 'all') {
        activeStatusFilters.Live = true;
        activeStatusFilters.Scheduled = true;
    } else if (statusVal === 'live') {
        activeStatusFilters.Live = true;
        activeStatusFilters.Scheduled = false;
    } else if (statusVal === 'scheduled') {
        activeStatusFilters.Live = false;
        activeStatusFilters.Scheduled = true;
    }

    // Check if any filter is customized away from defaults
    const isCustomized = (statusVal !== 'all' || sortVal !== 'time' || personalVal !== 'all');

    // 1. PURPLE HIGHLIGHT FOR FILTER HEADER ICON
    const filterBtn = document.getElementById('filterMenuBtn');
    if (filterBtn) {
        filterBtn.style.color = isCustomized ? '#9c27b0' : '#2d2d2d';
    }

    // 2. DYNAMICALLY ENABLE / DISABLE RESET BUTTON
    const resetBtn = document.getElementById('resetFiltersBtn');
    if (resetBtn) {
        if (isCustomized) {
            resetBtn.disabled = false;
            resetBtn.style.background = '#f3e8ff'; // Light purple background
            resetBtn.style.color = '#9c27b0';      // Purple text & icon
            resetBtn.style.cursor = 'pointer';
            resetBtn.style.opacity = '1';
        } else {
            resetBtn.disabled = true;
            resetBtn.style.background = '#f1f5f9'; // Greyed background
            resetBtn.style.color = '#94a3b8';      // Muted text
            resetBtn.style.cursor = 'not-allowed';
            resetBtn.style.opacity = '0.6';
        }
    }

    // --- SYNC VIEW & HIDE ALERT ---
    if (typeof syncAppView === 'function') {
        syncAppView();
    }

    if (typeof window.hideNewPostAlert === 'function') {
        window.hideNewPostAlert();
    }
};

window.handleFeedCounterClick = function() {
    const alertDot = document.getElementById('new-posts-alert');
    
    if (alertDot && alertDot.style.display !== 'none') {
        handleSortChange();
        
        const wrapper = document.getElementById('feed-counter-wrapper');
        if (wrapper) {
            wrapper.style.transform = 'scale(0.95)';
            setTimeout(() => wrapper.style.transform = 'scale(1)', 100);
        }
    }
};

// Update this in your New Post Listener
window.showNewPostAlert = function() {
    const alertDot = document.getElementById('new-posts-alert');
    const wrapper = document.getElementById('feed-counter-wrapper');
    
    if (alertDot && wrapper) {
        alertDot.style.display = 'flex';
        wrapper.style.cursor = 'pointer'; // Change cursor only when clickable
        wrapper.title = "Click to refresh feed"; // Tooltip for clarity
    }
};

window.hideNewPostAlert = function() {
    const alertDot = document.getElementById('new-posts-alert');
    const wrapper = document.getElementById('feed-counter-wrapper');
    
    if (alertDot && wrapper) {
        alertDot.style.display = 'none';
        wrapper.style.cursor = 'default';
        wrapper.title = "";
    }
};

function getVisiblePosts() {
    const currentZoom = map.getZoom();
    const MIN_FEED_ZOOM = 13; 
    const userId = getPulseUserId(); 

    if (currentZoom < MIN_FEED_ZOOM) {
        return "TOO_FAR"; 
    }

    const bounds = map.getBounds();
    // --- EDGE BUFFER LOGIC ---
    const latMargin = (bounds.getNorth() - bounds.getSouth()) * 0.05;
    const lngMargin = (bounds.getEast() - bounds.getWest()) * 0.05;

    const innerBounds = L.latLngBounds(
        [bounds.getSouth() + latMargin, bounds.getWest() + lngMargin],
        [bounds.getNorth() - latMargin, bounds.getEast() - lngMargin]
    );

    // READ DIRECTLY FROM CHECKED RADIO BUTTONS
    const selectedSort = document.querySelector('input[name="sortByRadio"]:checked');
    const selectedPersonal = document.querySelector('input[name="personalFilterRadio"]:checked');
    
    const sortValue = selectedSort ? selectedSort.value : 'time';
    const personalValue = selectedPersonal ? selectedPersonal.value : 'all';
    
    const now = Date.now();

    // 1. Filter the posts
    let filteredPosts = allPosts.filter(post => {
        post.isOnEdge = !innerBounds.contains([post.lat, post.lng]); 
        
        // --- A. SPATIAL & CATEGORY FILTERS ---
        const isWithinMapBounds = bounds.contains([post.lat, post.lng]);
        const matchesCategory = (currentCategory === 'All' || post.category === currentCategory);
        
        // --- B. STATUS & TIMING ---
        const startTime = post.scheduledStartTime || post.createdAt;
        const isFuture = startTime > now;
        const postType = isFuture ? 'Scheduled' : 'Live';
        const isStatusMatch = activeStatusFilters[postType];

        // --- C. PERSONAL FILTERS ---
        if (personalValue === 'myPosts' && post.authorId !== userId) return false;
        if (personalValue === 'myLikes') {
            const hasLiked = post.likedBy && post.likedBy[userId];
            if (!hasLiked) return false;
        }

        // --- D. RANGE FILTER ---
        let isWithinPhysicalRange = true; 
        if (window.userLatLng) {
            const distance = getDistance(window.userLatLng.lat, window.userLatLng.lng, post.lat, post.lng);
            if (currentZoom < 15) {
                isWithinPhysicalRange = distance <= MAX_DISTANCE;
            }
        }
        
        return isWithinMapBounds && matchesCategory && isWithinPhysicalRange && isStatusMatch;
    });

    // 2. Sort the filtered results
    return filteredPosts.sort((a, b) => {
        const startA = a.scheduledStartTime || a.createdAt;
        const startB = b.scheduledStartTime || b.createdAt;

        // --- SORT: MOST POPULAR ---
        if (sortValue === 'popular') {
            const likesA = a.likes || 0;
            const likesB = b.likes || 0;
            if (likesA !== likesB) return likesB - likesA; 
            return (b.createdAt || 0) - (a.createdAt || 0);
        }

        // --- SORT: DISTANCE ---
        else if (sortValue === 'distance' && window.userLatLng) {
            const distA = getDistance(window.userLatLng.lat, window.userLatLng.lng, a.lat, a.lng);
            const distB = getDistance(window.userLatLng.lat, window.userLatLng.lng, b.lat, b.lng);
            return distA - distB; 
        } 
        
        // --- SORT: TIME LEFT (Live Pulses) ---
        else if (sortValue === 'timeLeft') {
            const lifespanA = (a.lifespanHours || 24) * 60 * 60 * 1000;
            const lifespanB = (b.lifespanHours || 24) * 60 * 60 * 1000;
            const remainingA = (startA + lifespanA) - now;
            const remainingB = (startB + lifespanB) - now;
            return remainingB - remainingA; 
        }

        // --- SORT: UPCOMING (Future Pulses) ---
        else if (sortValue === 'start') {
            if (startA !== startB) return startA - startB; 
            return (b.createdAt || 0) - (a.createdAt || 0);
        } 
        
        // --- DEFAULT SORT: NEWEST POSTED ---
        else {
            const postedA = a.createdAt || a.scheduledStartTime || 0;
            const postedB = b.createdAt || b.scheduledStartTime || 0;

            if (postedA !== postedB) return postedB - postedA;

            const finalA = a.scheduledStartTime || a.createdAt || 0;
            const finalB = b.scheduledStartTime || b.createdAt || 0;
            return finalA - finalB;
        }
    });
}

let activeStatusFilters = {
    Live: true,
    Scheduled: true
};

// Helper function to update radio check state programmatically
function setSortRadioValue(value) {
    const radio = document.querySelector(`input[name="sortByRadio"][value="${value}"]`);
    if (radio) radio.checked = true;
}

window.toggleStatusFilter = function(type) {
    // 1. Toggle the logic state
    activeStatusFilters[type] = !activeStatusFilters[type];
    
    // 2. Surgical Snap-Back Logic
    const selectedSort = document.querySelector('input[name="sortByRadio"]:checked');
    const currentSort = selectedSort ? selectedSort.value : 'time';

    if (currentSort === 'timeLeft' && (!activeStatusFilters.Live || activeStatusFilters.Scheduled)) {
        setSortRadioValue('time');
    }
    
    if (currentSort === 'start' && (activeStatusFilters.Live || !activeStatusFilters.Scheduled)) {
        setSortRadioValue('time');
    }

    // 3. One call to update everything
    syncAppView();
};
window.resetFilters = function() {
    // 1. Reset radio buttons back to defaults (top options)
    const statusDefault = document.querySelector('input[name="statusFilterRadio"][value="all"]');
    const sortDefault = document.querySelector('input[name="sortByRadio"][value="time"]');
    const personalDefault = document.querySelector('input[name="personalFilterRadio"][value="all"]');

    if (statusDefault) statusDefault.checked = true;
    if (sortDefault) sortDefault.checked = true;
    if (personalDefault) personalDefault.checked = true;

    // 2. Clear state memory tracker
    if (typeof currentActiveSort !== 'undefined') {
        currentActiveSort = 'time';
    }

    // 3. Trigger change handler to sync views, status filters, and filter icon color
    handleSortChange();
};
function refreshMapMarkers(posts) {
    const now = Date.now();
    const bounds = map.getBounds();
    const userId = getPulseUserId(); // Get the current user ID
    // Get the current personal filter state
    const personalDropdown = document.getElementById('personalFilter');
    const personalValue = personalDropdown ? personalDropdown.value : 'all';
    
    // 1. DEFINE THE SAFE ZONE (5% Buffer)
    const latMargin = (bounds.getNorth() - bounds.getSouth()) * 0.05;
    const lngMargin = (bounds.getEast() - bounds.getWest()) * 0.05;

    const safeBounds = L.latLngBounds(
        [bounds.getSouth() + latMargin, bounds.getWest() + lngMargin],
        [bounds.getNorth() - latMargin, bounds.getEast() - lngMargin]
    );

    // Track IDs in this update to remove expired ones later
    const currentIds = new Set();

    posts.forEach(post => {
        const matchesCategory = (currentCategory === 'All' || post.category === currentCategory);
        if (!matchesCategory) return;
        // --- 2. STATUS FILTER (NEW) ---
        const startTime = post.scheduledStartTime || post.createdAt;
        const isFuture = startTime > now;
        const postType = isFuture ? 'Scheduled' : 'Live';
        // If the toggle for this type is OFF, skip this marker
        if (!activeStatusFilters[postType]) return;

        // --- 3. PERSONAL FILTERS (NEW) ---
        if (personalValue === 'myPosts' && post.authorId !== userId) return;
        if (personalValue === 'myLikes') {
            const hasLiked = post.likedBy && post.likedBy[userId];
            if (!hasLiked) return;
        }
        
        const lifespanMs = (post.lifespanHours || 24) * 60 * 60 * 1000;
        const expirationTime = startTime + lifespanMs;

        // Skip fully expired posts
        if (now > expirationTime) return; 

        if (post.lat && post.lng) {
            currentIds.add(post.id);
            const isInsideSafeZone = safeBounds.contains([post.lat, post.lng]);
            const targetOpacity = isInsideSafeZone ? 1.0 : 0.9;

            // PREPARE POPUP CONTENT (Plain text snippet preserving hashtags/mentions)
            const rawDescription = (post.description || '').trim();
            const words = rawDescription ? rawDescription.split(/\s+/) : [];
            let displayTitle = words.length > 0 
                ? (words.length > 4 ? words.slice(0, 4).join(' ') + '...' : words.join(' ')) 
                : 'Untitled Post';

            // Escape HTML characters to ensure plain text rendering
            displayTitle = displayTitle
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');

            const popupContent = `
                <div style="text-align: center; min-width: 150px; font-family: sans-serif;">
                    <b style="color: #333;">${displayTitle}</b><br>
                    <button onclick="focusPostInFeed('${post.id}')" 
                            style="margin-top: 10px; cursor: pointer; background: #ff3100; color: white; border: none; padding: 5px 10px; border-radius: 4px; font-weight: 600;">
                        View Post
                    </button>
                </div>
            `;

            // --- A. IF MARKER EXISTS: UPDATE IT ---
            if (markersById[post.id]) {
                const marker = markersById[post.id];
                const el = marker.getElement();

                if (marker.options.opacity !== targetOpacity) {
                    marker.setOpacity(targetOpacity);
                }

                if (isInsideSafeZone) {
                    // 1. RE-ENABLE CLICKING
                    if (!marker.options.interactive) {
                        marker.options.interactive = true;
                        if (el) {
                            // Force Leaflet to re-attach its event listeners to the element
                            marker.addInteractiveTarget(el);
                            el.style.pointerEvents = 'auto';
                            el.style.cursor = 'pointer';
                        }
                    }
                    
                    // 2. RE-ATTACH POPUP
                    if (!marker.getPopup()) {
                        marker.bindPopup(popupContent);
                    } else {
                        marker.setPopupContent(popupContent);
                    }
                } else {
                    // 3. DISABLE CLICKING
                    if (marker.options.interactive) {
                        marker.closePopup();
                        marker.options.interactive = false;
                        if (el) {
                            // Force Leaflet to stop listening to this element
                            marker.removeInteractiveTarget(el);
                            el.style.pointerEvents = 'none';
                            el.style.cursor = 'default';
                        }
                    }
                }
            }
            // --- B. IF NEW: CREATE IT ---
            else {
                const marker = L.marker([post.lat, post.lng], { 
                    icon: getIcon(post.category),
                    opacity: targetOpacity,
                    interactive: isInsideSafeZone 
                });

                if (isInsideSafeZone) {
                    marker.bindPopup(popupContent);
                }

                markersById[post.id] = marker;
                markerGroup.addLayer(marker);
            }
        }
    });
    // --- CLEANUP ---
    Object.keys(markersById).forEach(id => {
        if (!currentIds.has(id)) {
            markerGroup.removeLayer(markersById[id]);
            delete markersById[id];
        }
    });
}
window.focusPostInFeed = (postId) => {
    // 1. Close the popup
    map.closePopup();
    
    // 2. Find the card by ID
    // Note: You need to add 'id="post-${postId}"' to the card div in updateFeed()
    const element = document.getElementById(`post-${postId}`);
    
    if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        // Add a temporary highlight effect
        element.style.transition = "background-color 0.5s";
        element.style.backgroundColor = "#101672"; // Light yellow highlight
        setTimeout(() => {
            element.style.backgroundColor = "transparent";
        }, 2000);
    } else {
        alert("This post is currently outside your filter view.");
    }
};

window.deletePost = async (id) => {
    // We removed the confirm() from here so this function 
    // only runs if the user has ALREADY said yes.
    try {
        await remove(ref(db, `pulses/${id}`));
        return true; 
    } catch (e) {
        if (e.code === 'PERMISSION_DENIED') {
            console.warn("Delete ignored: Post likely already removed by server.");
            return true; // Treat as success since the goal (deletion) is achieved
        } else {
            console.error("Manual delete failed:", e);
            throw e; // Rethrow so the UI can revert opacity
        }
    }
};

function updateFeed(posts) {
    const feed = document.getElementById('feed');
    const alertEl = document.getElementById('new-posts-alert');
    
    // Hide the "New" alert since the user just refreshed/updated
    if (alertEl) alertEl.style.display = 'none';
    
    // 1. Handle "Too Far" State
    if (posts === "TOO_FAR") {
        feed.innerHTML = `
            <div class="zoom-warning" style="text-align: center; padding: 40px 20px; color: #888;">
                <svg viewBox="0 0 24 24" width="40" height="40" stroke="currentColor" fill="none" style="margin-bottom: 15px; opacity: 0.5;">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    <line x1="11" y1="8" x2="11" y2="14"></line>
                    <line x1="8" y1="11" x2="14" y2="11"></line>
                </svg>
                <p style="font-weight: 600; margin-bottom: 5px;">Zoom in to see posts</p>
                <p style="font-size: 13px;">You're a bit too high up! Zoom into a neighborhood to see the live feed.</p>
            </div>
        `;
        return;
    }

    const loader = document.getElementById('loading-indicator');
    if (loader) loader.style.display = 'none';
    
    // 2. Reset Feed and Logic
    const initialLoader = document.getElementById('loading-indicator');
    if (initialLoader) initialLoader.style.display = 'none';
    
    // 2. RESET FEED & INJECT LOADER
    // This ensures the loader always exists for renderNextSlice to find
    feed.innerHTML = `
        <div id="infinite-loader" style="display: none; text-align: center; width: 100%;">
            <div class="spinner" style="
                width: 28px; 
                height: 28px; 
                border: 4px solid rgba(255, 255, 255, 0.05); 
                border-top: 4px solid #f03e33; 
                border-right: 4px solid transparent; 
                border-radius: 50%; 
                display: inline-block;
                animation: spin 0.8s cubic-bezier(0.4, 0, 0.2, 1) infinite;
            "></div>
        </div>
    `;
    const now = Date.now();
    
    // Filter out edge posts and expired posts once
    allFilteredPosts = posts.filter(post => {
        if (post.isOnEdge) return false;
        const startTime = post.scheduledStartTime || post.createdAt;
        const lifespanMs = (post.lifespanHours || 24) * 60 * 60 * 1000;
        return now <= (startTime + lifespanMs);
    });
    activeFeedIds = new Set(allFilteredPosts.map(p => p.id));

    // 3. Initial Render
    currentSliceIndex = 0;
    renderNextSlice();

    // 4. Empty State check
    if (allFilteredPosts.length === 0) {
        feed.innerHTML = `
            <div style="text-align:center; color:#999; margin-top:40px; padding: 20px;">
                <p style="font-size: 16px; margin-bottom: 8px;">No posts in view</p>
                <p style="font-size: 13px;">Try moving the map or be the first to share one!</p>
            </div>`;
    }
    
    updateCounter(allFilteredPosts.length);
}
function renderNextSlice() {
    const feed = document.getElementById('feed');
    const now = Date.now();
    const currentUserId = getPulseUserId();

    // Get the next batch of posts
    const nextBatch = allFilteredPosts.slice(currentSliceIndex, currentSliceIndex + SLICE_SIZE);
    
    nextBatch.forEach(post => {
        const startTime = post.scheduledStartTime || post.createdAt;
        const lifespanMs = (post.lifespanHours || 24) * 60 * 60 * 1000;

        const card = document.createElement('div');
        const username = getPulseHandle(post.authorId || 'Anonymous');
        const relativeTime = getFormattedTime(post);
        card.className = 'post-card';
        card.id = `post-${post.id}`;

        // --- DISTANCE LOGIC ---
        let distanceBadge = '';
        if (window.userLatLng && post.lat && post.lng) {
            const dist = getDistance(
                parseFloat(window.userLatLng.lat), 
                parseFloat(window.userLatLng.lng), 
                parseFloat(post.lat), 
                parseFloat(post.lng)
            );
            let distText = '';
            if (dist < 20) distText = 'Nearby'; 
            else if (dist < 100) distText = (Math.round(dist / 5) * 5) + 'm';
            else if (dist < 950) distText = (Math.round(dist / 10) * 10) + 'm';
            else distText = (dist / 1000).toFixed(1) + 'km';
            distanceBadge = `${distText}`;
        } else {
            distanceBadge = `-`;
        }
        // --- TIMER & DATE FORMATTING LOGIC ---
        const isPending = startTime > now;
        const expirationTime = startTime + lifespanMs;
        const isExpired = now > expirationTime; 
        const timeRemainingMs = expirationTime - now;
        let minsRemaining = Math.max(0, Math.floor(timeRemainingMs / 60000));
        
        // Date objects for start and end times
        const startDateObj = new Date(startTime);
        const endDateObj = new Date(expirationTime);
        const lifespanHoursVal = (post.lifespanHours || 24);

        // Helper formatting
        const startDay = startDateObj.getDate();
        const endDay = endDateObj.getDate();
        const monthStr = startDateObj.toLocaleDateString('no-NO', { month: 'short' }).replace('.', '').toLowerCase(); // e.g. "aug"

        // Time formatting: "12" if minutes are 00, otherwise "12:30"
        const hours = startDateObj.getHours();
        const minutes = startDateObj.getMinutes();
        const startTimeStr = minutes === 0 ? `${hours}` : `${hours}:${minutes.toString().padStart(2, '0')}`;

        let formattedUpcomingDate = '';

        if (lifespanHoursVal >= 24) {
            // Multi-day / long post -> "2.-3. aug" or "31. jul-2. aug" (if month changes)
            const endMonthStr = endDateObj.toLocaleDateString('no-NO', { month: 'short' }).replace('.', '').toLowerCase();
            if (monthStr === endMonthStr) {
                formattedUpcomingDate = `${startDay}.-${endDay}. ${monthStr}`;
            } else {
                formattedUpcomingDate = `${startDay}. ${monthStr}-${endDay}. ${endMonthStr}`;
            }
        } else {
            // 12h or short post -> "2. aug kl. 12" (or "2. aug kl. 12:30")
            formattedUpcomingDate = `${startDay}. ${monthStr} kl. ${startTimeStr}`;
        }

        let displayTimeText = '';

        if (isPending) {
            // Upcoming post -> Display dynamic event date string
            displayTimeText = formattedUpcomingDate;
        } else {
            // Live post -> Calculate remaining time countdown with SVG icon
            let timeVal;
            const totalHoursRemaining = Math.floor(minsRemaining / 60);
            if (minsRemaining >= 2160) timeVal = `${Math.round(minsRemaining / 1440)}d`;
            else if (minsRemaining >= 1080) timeVal = `1d`;
            else if (totalHoursRemaining >= 1) {
                const mins = minsRemaining % 60;
                timeVal = mins > 0 ? `${totalHoursRemaining}h ${mins}m` : `${totalHoursRemaining}h`;
            } else timeVal = `${minsRemaining}m`;
            
            displayTimeText = `Live: ${timeVal} left`;
        }
        // --- MEDIA GALLERY LOGIC ---
        const media = post.mediaItems || [];
        let galleryHtml = '';
        const imageMode = post.imageMode || 'portrait'; 
        const modeClass = imageMode === 'landscape' ? 'mode-landscape' : 'mode-portrait';

        if (media.length > 0) {
            const itemsHtml = media.map(item => {
                if (item.type === 'video') {
                    return `<video src="${item.url}" muted loop playsinline autoplay style="width:100%; height:100%; object-fit:cover;"></video>`;
                } else {
                    return `<img src="${item.url}" loading="lazy" alt="Post content" style="width:100%; height:100%; object-fit:cover;">`;
                }
            }).join('');

            const navArrows = media.length > 1 ? `
                <button class="nav-arrow left hidden" onclick="scrollGallery(this, -1)" style="left: 10px;">
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="#fff" stroke-width="3" fill="none"><polyline points="15 18 9 12 15 6"></polyline></svg>
                </button>
                <button class="nav-arrow right" onclick="scrollGallery(this, 1)" style="right: 10px;">
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="#fff" stroke-width="3" fill="none"><polyline points="9 18 15 12 9 6"></polyline></svg>
                </button>
                <div class="gallery-dots">
                    ${media.map((_, index) => `<span class="gallery-dot ${index === 0 ? 'active' : ''}"></span>`).join('')}
                </div>` : '';

            galleryHtml = `<div class="post-card-image-wrapper ${modeClass}">${navArrows}<div class="image-gallery">${itemsHtml}</div></div>`;
        }

        // --- BUTTONS & INFO LOGIC ---
        const isAuthor = post.authorId === currentUserId;
        const endTime = startTime + ((post.lifespanHours || 24) * 60 * 60 * 1000);
        const badgeLabel = isPending ? 'UPCOMING' : 'LIVE';
        
        const formatD = (ts) => { const d = new Date(ts); return `${d.getDate()} ${d.toLocaleDateString([], { month: 'short' })}`; };
        const startDateStr = formatD(startTime);
        const endDateStr = formatD(endTime);
        const startT = new Date(startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
        const endT = new Date(endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
        const isInfoMultiDay = startDateStr !== endDateStr;
        const statusLabel = isPending ? 'Scheduled' : 'Live';

        let timeDetailsHtml = isInfoMultiDay ? `
            <span>${statusLabel} from:</span>
            <div>${startT} - ${startDateStr}</div>
            <span>Until:</span>
            <div>${endT} - ${endDateStr}</div>` : `
            <span>${statusLabel}:</span>
            <div>${startT} - ${endT}<div>${startDateStr}</div></div>`;
        // Pure detail content (No button wrapper or tooltips)
        const infoDetailsContentHtml = `
            <div style="font-family: sans-serif;">
                <div style="margin-bottom: 8px;">
                    <span>Posted ${relativeTime} by</span>
                    <strong>${username}</strong>
                </div>
                <div style="border-top: 1px solid #e2e8f0; padding-top: 8px; color: #334155; font-size: 12px; line-height: 1.4;">
                    ${timeDetailsHtml}
                </div>
            </div>
        `;

        // BADGE COLORS: LIVE stays consistently green; UPCOMING stays orange
        let badgeBg = isPending ? 'rgb(59 32 10 / 0.75)' : 'rgb(19 40 30 / 0.75)';
        let badgeColor = isPending ? '#ff922b' : '#69dbb6';
        let badgeBorder = isPending ? 'rgba(253, 126, 20, 0.3)' : 'rgba(64, 192, 87, 0.3)';

        // TIMER STYLING
        const isUrgent = !isPending && !isExpired && (minsRemaining < 30);
        const timerContainerColor = isUrgent ? '#ca2727' : 'inherit';

        const userId = getPulseUserId();
        const hasUserLiked = post.likedBy && post.likedBy[userId];

        const heartFill = hasUserLiked ? "#d22f6d" : "none";
        const heartStroke = hasUserLiked ? "#d22f6d" : "#433838";
// --- AUTHOR AVATAR LOGIC ---
        let authorAvatarUrl = post.authorAvatar || null;
        if (!authorAvatarUrl && post.authorId === currentUserId) {
            authorAvatarUrl = localStorage.getItem(`pulse_avatar_${currentUserId}`) || null;
        }
// --- MEDIA OVERLAYS (AUTHOR BOTTOM-LEFT & LINK TOP-RIGHT) ---
        let topRightOverlayHtml = '';
// --- AUTHOR DATA & PREVIEWS ---
const authorHandle = post.authorUsername || '';

// Gather previews for popover
const authorPosts = allPosts.filter(p => p.authorId === post.authorId || p.authorUsername === post.authorUsername);
const authorPostCount = authorPosts.length;
const authorPreviewsHtml = authorPosts
    .filter(p => p.mediaItems && p.mediaItems.length > 0)
    .slice(0, 3)
    .map(p => `<div style="width: 38px; height: 38px; border-radius: 6px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1); flex-shrink: 0;"><img src="${p.mediaItems[0].url}" style="width:100%; height:100%; object-fit:cover;"></div>`)
    .join('');

// 1. INLINE USERNAME FOR DESCRIPTION (Bold text only, no avatar)
const inlineAuthorHtml = authorHandle 
    ? `<strong onclick="filterFeedByUser('${post.authorId}', '${post.authorUsername}')" style="font-weight: 700; font-family:monospace; text-decoration:underline; color: #8e011e; margin-right: 6px;">${authorHandle}</strong>` 
    : '';

// 2. CLICKABLE AVATAR + POPOVER FOR ACTION ROW (RIGHT SIDE)
const actionRowAvatarHtml = authorAvatarUrl ? `
    <div style="position: relative; display: flex; align-items: center;">
        <button onclick="toggleAuthorPopover(event, '${post.id}')" style="
            background: none; 
            border: 0; 
            padding: 0; 
            cursor: pointer; 
            display: flex; 
            align-items: center; 
            justify-content: center;
        " title="${authorHandle}">
            <img src="${authorAvatarUrl}" style="
                width: 24px; 
                height: 24px; 
                border-radius: 50%; 
                object-fit: cover; 
                border: 1.5px solid #fff;
                box-shadow: 0 1px 2px rgba(0,0,0,0.1);
            " />
        </button>

        <!-- AUTHOR POPOVER CARD -->
        <div id="author-popover-${post.id}" class="author-popover" style="
            display: none;
            position: absolute;
            right: 0;
            bottom: 30px;
            z-index: 35;
            width: 220px;
            padding: 12px;
            border-radius: 16px;
            background: rgba(0, 0, 0, 0.85);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border: 1px solid rgba(255, 255, 255, 0.15);
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            color: #ffffff;
            text-align: left;
            pointer-events: auto;
            font-weight: normal;
        ">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
                <div style="
                    width: 44px; 
                    height: 44px; 
                    border-radius: 50%; 
                    background: ${authorAvatarUrl ? `url('${authorAvatarUrl}') center/cover` : '#334155'}; 
                    border: 2px solid #ffffff;
                    background-color: white;
                    flex-shrink: 0;
                "></div>
                <div style="overflow: hidden; min-width: 0;">
                    <div style="font-weight: 700; font-size: 13px; color: #ffffff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                        ${authorHandle}
                    </div>
                    <div style="font-size: 11px; color: #94a3b8; font-weight: 500;">
                        ${authorPostCount} active ${authorPostCount === 1 ? 'post' : 'posts'}
                    </div>
                </div>
            </div>

            <div style="border-top: 1px solid rgba(255,255,255,0.1); padding-top: 8px; margin-top: 4px;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                    <span style="font-size: 10px; text-transform: uppercase; color: #a1a1aa; font-weight: 600; letter-spacing: 0.5px;">Live Previews</span>
                    <button onclick="filterFeedByUser('${post.authorId}', '${post.authorUsername}')" style="
                        background: rgba(255, 255, 255, 0.15);
                        border: 1px solid rgba(255, 255, 255, 0.2);
                        color: #ffffff;
                        font-size: 10px;
                        font-weight: 700;
                        padding: 2px 8px;
                        border-radius: 10px;
                        cursor: pointer;
                    ">
                        View
                    </button>
                </div>
                ${authorPreviewsHtml ? `
                    <div style="display: flex; gap: 6px;">
                        ${authorPreviewsHtml}
                    </div>
                ` : ''}
            </div>
        </div>
    </div>
` : '';

// 2. EXTERNAL LINK PILL (TOP RIGHT)
        if (post.link) {
            topRightOverlayHtml = `
                <div style="
                    position: absolute; 
                    bottom: 16px; 
                    left: 12px; 
                    z-index: 10; 
                    pointer-events: auto;
                ">
                    <a href="${post.link}" target="_blank" rel="noopener noreferrer" 
                    style="
                        display: inline-flex; 
                        align-items: center; 
                        gap: 6px; 
                        padding: 4px 10px; 
                        border-radius: 14px; 
                        background: rgba(0, 0, 0, 0.5); 
                        backdrop-filter: blur(4px);
                        text-decoration: none; 
                        transition: background 0.2s;
                        max-width: 140px;
                    ">
                        <svg viewBox="0 0 24 24" width="12" height="12" stroke="#ffffff" stroke-width="2.5" fill="none" style="flex-shrink: 0;">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                            <polyline points="15 3 21 3 21 9"></polyline>
                            <line x1="10" y1="14" x2="21" y2="3"></line>
                        </svg>
                        <span style="
                            font-size: 11px; 
                            color: #ffffff; 
                            font-weight: 600; 
                            white-space: nowrap; 
                            overflow: hidden; 
                            text-overflow: ellipsis;
                            text-shadow: 0 1px 2px rgba(0,0,0,0.5);
                        ">
                            ${new URL(post.link).hostname.replace('www.', '')}
                        </span>
                    </a>
                </div>
            `;
        }
// Extract street address name (removing district)
        const locationName = post.address ? post.address.split(',')[0].trim() : 'Unknown Location';
// Clean main category string (plain text, no hashtag)
const mainCategoryText = post.category ? post.category.trim() : '';

// Faded background colors paired with readable darkened text colors
const categoryColorMap = {
    'Food': { bg: '#ff6060', text: '#000000' },      
    'Art': { bg: '#5eaeff', text: '#000000' },       
    'Music': { bg: '#a24bff', text: '#000000' },     
    'Urban': { bg: '#ffd738', text: '#000000' },     
    'Community': { bg: '#a5a5a5', text: '#000000' }, 
    'Nature': { bg: '#21ca0f', text: '#000000' }      
};

// Fallback style if category is unknown/custom
const activeCategoryStyle = categoryColorMap[mainCategoryText] || { bg: '#d7cdc0', text: '#64748b' };

// CATEGORY-COLORED LOCATION BUTTON WITH DROP SHADOW FOR MEDIA OVERLAY
const categoryColor = activeCategoryStyle.bg;

const locateBtnHtml = `
    <button class="locate-btn" data-id="${post.id}" title="Show on Map" style="
        background: transparent; 
        border: 0; 
        color: ${categoryColor}; 
        padding: 0px; 
        cursor: pointer; 
        display: flex; 
        align-items: center; 
        justify-content: center; 
        flex-shrink: 0; 
        transition: transform 0.2s;
        filter: drop-shadow(0 1px 3px rgba(0,0,0,0.7));
    ">
        <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
            <circle cx="12" cy="10" r="3"></circle>
        </svg>
    </button>
`;

// --- FROSTED OVERLAY TOP SUB-HEADER (LOCATION ON LEFT, TIME REMAINING ON RIGHT) ---
const postSubHeaderHtml = `
    <div class="post-sub-header-overlay" style="
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        z-index: 20;
        display: flex; 
        justify-content: space-between; 
        align-items: center; 
        padding: 8px 12px;
        gap: 8px;
        background: linear-gradient(180deg, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.2) 70%, rgba(0,0,0,0) 100%);
        pointer-events: auto;
        color: #ffffff;
    ">
        <!-- LEFT SIDE: CATEGORY-COLORED LOCATION BUTTON + 2-ROW ADDRESS & DISTANCE -->
        <div style="
            display: flex; 
            align-items: center; 
            gap: 8px; 
            min-width: 0;
        ">
            <div style="flex-shrink: 0;">
                ${locateBtnHtml}
            </div>
            <div style="
                display: flex; 
                flex-direction: column; 
                min-width: 0; 
                line-height: 1.2;
            ">
                <!-- ROW 1: ADDRESS -->
                <span style="
                    font-size: 11.5px;
                    font-weight: 700;
                    color: #ffffff;
                    white-space: nowrap; 
                    overflow: hidden; 
                    text-overflow: ellipsis;
                    text-shadow: 0 1px 3px rgba(0,0,0,0.8);
                ">
                    ${locationName}
                </span>

                <!-- ROW 2: DISTANCE AWAY -->
                ${distanceBadge && distanceBadge !== '-' ? `
                    <span style="
                        font-size: 10px;
                        font-weight: 500;
                        color: rgba(255, 255, 255, 0.8);
                        white-space: nowrap; 
                        overflow: hidden; 
                        text-overflow: ellipsis;
                        text-shadow: 0 1px 2px rgba(0,0,0,0.8);
                    ">
                        ${distanceBadge}
                    </span>
                ` : ''}
            </div>
        </div>

        <!-- RIGHT SIDE: TIME REMAINING BADGE -->
        <div style="
            display: flex;
            align-items: center;
            gap: 6px;
            color: #ffffff;
            font-size: 11.5px;
            font-weight: 600;
            white-space: nowrap;
            flex-shrink: 0;
            text-shadow: 0 1px 3px rgba(0,0,0,0.8);
        ">
            <span>
                ${isExpired ? `
                    <span class="expired-tag" style="color: #f87171; font-weight: 800; text-transform: uppercase;">EXPIRED</span>
                ` : `
                    <span class="pulse-timer" data-start="${startTime}" data-expiry="${expirationTime}">
                        ${displayTimeText}
                    </span>
                `}
            </span>
        </div>
    </div>
`;
        
        // --- PROGRESS BAR CALCULATION LOGIC ---
        const lifespanHours = Number(post.lifespanHours) || 24;
        const POST_LIFESPAN_MS = lifespanHours * 60 * 60 * 1000;
        let progressBarHtml = '';

        const isCurrentlyPending = startTime > now;

        if (isCurrentlyPending) {
            // SCHEDULED / UPCOMING POST: Solid orange bar (100% full)
            progressBarHtml = `
                <div class="post-progress-track" data-start="${startTime}" data-lifespan="${POST_LIFESPAN_MS}" style="width: 100%; height: 6px; margin:4px auto; border-radius:8px; background-color: #ddd; overflow: hidden; display: block;">
                    <div class="post-progress-fill" style="width: 100%; height: 100%; background-color: #e69345;"></div>
                </div>
            `;
        } else {
            // LIVE POST: Green bar shrinking to the left over time
            const elapsedTime = now - startTime;
            const remainingTime = POST_LIFESPAN_MS - elapsedTime;

            let remainingPercentage = (remainingTime / POST_LIFESPAN_MS) * 100;
            if (remainingPercentage < 0) remainingPercentage = 0;
            if (remainingPercentage > 100) remainingPercentage = 100;

            progressBarHtml = `
                <div class="post-progress-track" data-start="${startTime}" data-lifespan="${POST_LIFESPAN_MS}" style="width: 100%; height: 6px; margin:4px auto; border-radius:8px; background-color: #ddd; overflow: hidden; display: block;">
                    <div class="post-progress-fill" style="
                        width: ${remainingPercentage.toFixed(2)}%; 
                        height: 100%; 
                        background-color: #2fbe90;
                        transition: width 1s linear, background-color 0.5s ease;
                    "></div>
                </div>
            `;
        }
        
        // Calculate total reactions & setup user choice state
        const counts = post.reactions || { interested: 0, countMeIn: 0, goodTip: 0 };
        const totalReactions = (counts.interested || 0) + (counts.countMeIn || 0) + (counts.goodTip || 0);
        
        // Ensure userRx persists on refresh by checking current user's UID against post.userReactions
        const userRx = (currentUserId && post.userReactions && post.userReactions[currentUserId]) 
            ? post.userReactions[currentUserId] 
            : (post.userReaction || null);
// Reaction SVG Icons (All 16x16 with stroke/fill responsive to styling)
const rxIconMap = {
    // 1. INTERESTED: Eye Icon
    interested: `
        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle;">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
            <circle cx="12" cy="12" r="3"></circle>
        </svg>
    `,

    // 2. COUNT ME IN: Hand / Raised Palm Icon
    countMeIn: `
        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle;">
            <path d="M18 11V6a2 2 0 0 0-4 0v5"></path>
            <path d="M14 10V4a2 2 0 0 0-4 0v6"></path>
            <path d="M10 10.5V6a2 2 0 0 0-4 0v8"></path>
            <path d="M18 8a2 2 0 0 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"></path>
        </svg>
    `,

    // 3. GOOD TIP: Lightbulb Icon
    goodTip: `
        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle;">
            <path d="M9 18h6"></path>
            <path d="M10 22h4"></path>
            <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1.55.6 2.81 1.5 3.5.76.76 1.23 1.52 1.41 2.5"></path>
        </svg>
    `
};
        // Floating Bottom-Right Reaction Overlay
        const reactionMediaOverlayHtml = `
        <div class="reaction-container" style="
            position: absolute; 
            bottom: 10px; 
            right: 10px; 
            z-index: 15; 
            pointer-events: auto;
            display: flex;
            align-items: center;
        ">
            <!-- TOTAL COUNT BADGE (Outside Left of Circle) -->
            ${totalReactions > 0 ? `
                <span style="
                    background: rgba(0, 0, 0, 0);
                    border: 0;
                    color: #ffffff;
                    font-size: 11px; 
                    font-weight: 700; 
                    text-shadow: 0 1px 2px rgba(0,0,0,0.6);
                    line-height: 1;
                ">
                    ${totalReactions}
                </span>
            ` : ''}

<!-- CIRCULAR REACTION BUTTON -->
            <button class="action-btn reaction-trigger-btn" onclick="toggleReactionMenu('${post.id}')" style="
                width: 34px;
                height: 34px;
                border-radius: 50%;
                background: rgba(0, 0, 0, 0);
                border: 0;
                color: #ffffff;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: transform 0.15s ease, background 0.15s ease;
                padding: 0;
            " title="Add Reaction">
                <!-- Active Reaction SVG OR Add-Reaction Plus SVG -->
                ${userRx ? `
                    <span style="display: flex; align-items: center; justify-content: center; color: #ffffff;">${rxIconMap[userRx]}</span>
                ` : `
                    <svg width="30" height="30" viewBox="-1.6 -1.6 19.20 19.20" xmlns="http://www.w3.org/2000/svg" fill="currentColor" style="filter: drop-shadow(0 1px 2px rgba(0,0,0,0.5)); flex-shrink: 0;">
                        <path fill-rule="evenodd" clip-rule="evenodd" d="M12 7.5c0 .169-.01.336-.027.5h1.005A5.5 5.5 0 1 0 8 12.978v-1.005A4.5 4.5 0 1 1 12 7.5zM5.5 7a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm2 2.5c.712 0 1.355-.298 1.81-.776l.707.708A3.49 3.49 0 0 1 7.5 10.5a3.49 3.49 0 0 1-2.555-1.108l.707-.708A2.494 2.494 0 0 0 7.5 9.5zm2-2.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm2.5 3h1v2h2v1h-2v2h-1v-2h-2v-1h2v-2z"></path>
                    </svg>
                `}
            </button>

<!-- REACTION POPOVER (DARK FROSTED GLASS) -->
            <div id="reaction-popover-${post.id}" class="reaction-popover" style="
                display: none;
                position: absolute;
                right: 0;
                bottom: 42px;
                z-index: 30;
                background: rgba(0, 0, 0, 0.65);
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                border: 1px solid rgba(255, 255, 255, 0.15);
                border-radius: 14px;
                padding: 6px;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
                flex-direction: column;
                gap: 4px;
                min-width: 155px;
            ">
                <!-- INTERESTED -->
                <div onclick="submitReaction('${post.id}', 'interested')" class="reaction-item ${userRx === 'interested' ? 'active' : ''}" style="
                    display: flex; 
                    align-items: center; 
                    justify-content: space-between; 
                    padding: 6px 10px; 
                    border-radius: 10px; 
                    cursor: pointer; 
                    transition: background 0.15s; 
                    font-size: 12px; 
                    color: #ffffff;
                    text-shadow: 0 1px 2px rgba(0,0,0,0.6);
                ">
                    <span style="display: flex; align-items: center; gap: 6px;">
                        ${rxIconMap.interested} Interested
                    </span>
                    <span style="
                        font-weight: 700; 
                        font-size: 11px; 
                        padding: 2px 7px; 
                        border-radius: 10px; 
                        background: ${userRx === 'interested' ? '#8b5cf6' : 'rgba(255, 255, 255, 0.15)'}; 
                        color: #ffffff;
                        border: 1px solid ${userRx === 'interested' ? '#a78bfa' : 'rgba(255, 255, 255, 0.1)'};
                    ">
                        ${counts.interested || 0}
                    </span>
                </div>
                
                <!-- COUNT ME IN -->
                <div onclick="submitReaction('${post.id}', 'countMeIn')" class="reaction-item ${userRx === 'countMeIn' ? 'active' : ''}" style="
                    display: flex; 
                    align-items: center; 
                    justify-content: space-between; 
                    padding: 6px 10px; 
                    border-radius: 10px; 
                    cursor: pointer; 
                    transition: background 0.15s; 
                    font-size: 12px; 
                    color: #ffffff;
                    text-shadow: 0 1px 2px rgba(0,0,0,0.6);
                ">
                    <span style="display: flex; align-items: center; gap: 6px;">
                        ${rxIconMap.countMeIn} Count me in
                    </span>
                    <span style="
                        font-weight: 700; 
                        font-size: 11px; 
                        padding: 2px 7px; 
                        border-radius: 10px; 
                        background: ${userRx === 'countMeIn' ? '#8b5cf6' : 'rgba(255, 255, 255, 0.15)'}; 
                        color: #ffffff;
                        border: 1px solid ${userRx === 'countMeIn' ? '#a78bfa' : 'rgba(255, 255, 255, 0.1)'};
                    ">
                        ${counts.countMeIn || 0}
                    </span>
                </div>
                
                <!-- GOOD TIP -->
                <div onclick="submitReaction('${post.id}', 'goodTip')" class="reaction-item ${userRx === 'goodTip' ? 'active' : ''}" style="
                    display: flex; 
                    align-items: center; 
                    justify-content: space-between; 
                    padding: 6px 10px; 
                    border-radius: 10px; 
                    cursor: pointer; 
                    transition: background 0.15s; 
                    font-size: 12px; 
                    color: #ffffff;
                    text-shadow: 0 1px 2px rgba(0,0,0,0.6);
                ">
                    <span style="display: flex; align-items: center; gap: 6px;">
                        ${rxIconMap.goodTip} Good tip
                    </span>
                    <span style="
                        font-weight: 700; 
                        font-size: 11px; 
                        padding: 2px 7px; 
                        border-radius: 10px; 
                        background: ${userRx === 'goodTip' ? '#8b5cf6' : 'rgba(255, 255, 255, 0.15)'}; 
                        color: #ffffff;
                        border: 1px solid ${userRx === 'goodTip' ? '#a78bfa' : 'rgba(255, 255, 255, 0.1)'};
                    ">
                        ${counts.goodTip || 0}
                    </span>
                </div>
            </div>
        </div>`;

        // --- AUTHOR USERNAME LOGIC ---
        // Only resolve explicit custom usernames (ignore random fallback handles)
        let authorDisplayName = post.authorUsername || null;

        if (!authorDisplayName && post.authorId === currentUserId) {
            authorDisplayName = localStorage.getItem(`pulse_username_${currentUserId}`) || null;
        }

card.innerHTML = `
    <!-- COMBINED MEDIA CARD WRAPPER -->
    <div style="
        width: 100%; 
        overflow: hidden; 
        box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    ">
        <!-- MEDIA CONTAINER -->
        <div style="position: relative; width: 100%; overflow: hidden;">
            ${postSubHeaderHtml}
            ${galleryHtml}
            ${topRightOverlayHtml}
            ${reactionMediaOverlayHtml}
        </div>    
    </div>  
            ${progressBarHtml}
    
    <div class="post-card-body" style="padding: 0;">

    <!-- ACTION ROW -->
<div style="
    display: flex; 
    justify-content: space-between; 
    align-items: center; 
    padding: 4px 10px 8px 10px;
    width: 100%;
    box-sizing: border-box;
    font-size: 11.5px;
    border-bottom: 1px solid #e9e9e9;
    font-weight: 500;
">
    <!-- LEFT COLUMN: ACTION BUTTONS (Like, Directions, Comments) -->
    <div style="
        display: inline-flex; 
        align-items: center; 
        gap: 12px; 
        flex-shrink: 0;
    ">
        <!-- 1. LIKE BUTTON + COUNT -->
        <div style="display: flex; align-items: center; gap: 4px;">
            <button class="action-btn" onclick="toggleLike('${post.id}')" style="width: 28px; height: 28px; background: none; border: 0; color: ${heartStroke}; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0;">
               <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="${heartFill}" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"></path>
               </svg>
            </button>
            <span id="like-count-${post.id}" style="font-size: 12px; font-weight: 600; color: #555; display: ${post.likes > 0 ? 'inline' : 'none'};">
                ${post.likes || 0}
            </span>
        </div>
        
        <!-- 2. DIRECTIONS BUTTON -->
        <button class="action-btn" onclick="openDirections(${post.lat}, ${post.lng})" style="width: 28px; height: 28px; background: none; border: 0; color: #433838; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0;" title="Get Directions">
            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="3 11 22 2 13 21 11 13 3 11"></polygon>
            </svg>
        </button>

        <!-- 3. COMMENTS BUTTON + COUNT -->
        <div style="display: flex; align-items: center; gap: 4px;">
            <button class="action-btn" onclick="toggleComments('${post.id}')" style="width: 28px; height: 28px; background: none; border: 0; color: #433838; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0;" title="Comments">
                <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
            </button>
            <span id="comment-count-${post.id}" style="font-size: 12px; font-weight: 600; color: #555; display: ${(post.commentsCount || (post.comments && post.comments.length)) > 0 ? 'inline' : 'none'};">
                ${post.commentsCount || (post.comments ? post.comments.length : 0)}
            </span>
        </div>
    </div>

    <!-- RIGHT COLUMN: PROFILE AVATAR + OPTIONS MENU BUTTON -->
    <div style="display: flex; align-items: center; gap: 8px; justify-content: flex-end;">
        ${actionRowAvatarHtml}

        <!-- OPTIONS MENU BUTTON -->
        <div class="options-menu-container" style="position: relative; display: inline-flex; align-items: center;">
            <button class="action-btn menu-trigger-btn" style="width: 28px; height: 28px; background: none; border: 0; color: #555; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0;">
                <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2.5" fill="none">
                    <circle cx="12" cy="12" r="1"></circle>
                    <circle cx="12" cy="5" r="1"></circle>
                    <circle cx="12" cy="19" r="1"></circle>
                </svg>
            </button>
            
            <div class="options-tooltip" style="right: 0; left: auto;">
                <div class="tooltip-item" onclick="openPostDetailsSheet('${post.id}')">
                    <span>Details</span>
                </div>
                <div class="tooltip-item" onclick="sharePost('${post.id}')">
                    <span>Share</span>
                </div>
                ${post.authorId === userId ? `
                <div class="tooltip-item delete-item" onclick="confirmDelete('${post.id}')">
                    <span>Delete</span>
                </div>` : ''}
            </div>
        </div>
    </div>
</div>

<!-- HIDDEN TEMPLATE HOLDING DETAILS CONTENT -->
<template id="post-info-data-${post.id}">
    ${infoDetailsContentHtml}
</template>
        <!-- DESCRIPTION WITH BOLD USERNAME ON SAME LINE -->
        <div class="postDescription">
            ${inlineAuthorHtml}${post.description ? formatHashtags(post.description) : ''}
        </div>

        <!-- POST DETAILS ROW (UPPERCASE CATEGORY • RELATIVE TIME) -->
        <div style="padding: 0px 10px 8px 10px; font-size: 7.5pt; color: #949494; font-weight: 500; display: flex; align-items: center; gap: 4px;">
            <span>${relativeTime}</span>    
            ${mainCategoryText ? `
                    <span>•</span>
                    <span>
                        ${mainCategoryText}
                    </span>
                ` : ''}
        </div>
    </div>
`;        
        // --- ATTACH LISTENERS ---
        const galleryEl = card.querySelector('.image-gallery');
        if (galleryEl && media.length > 1) {
            setTimeout(() => updateArrowVisibility(galleryEl), 50);
            galleryEl.addEventListener('scroll', () => updateArrowVisibility(galleryEl), { passive: true });
        }

        const locateBtn = card.querySelector('.locate-btn');
        if (locateBtn) {
            locateBtn.onclick = (e) => {
                e.stopPropagation();
                const marker = markersById[post.id];
                if (!marker) return;
                const header = document.querySelector('header');
                const FIXED_MAX = 450;
                if (header.offsetHeight < FIXED_MAX) {
                    header.style.transition = "height 0.5s cubic-bezier(0.19, 1, 0.22, 1)";
                    header.style.height = `${FIXED_MAX}px`;
                    if (typeof map !== 'undefined') setTimeout(() => map.invalidateSize({ animate: true }), 100);
                }
                document.querySelectorAll('.highlight-pin, .highlight-cluster').forEach(el => el.classList.remove('highlight-pin', 'highlight-cluster'));
                const visibleParent = markerGroup.getVisibleParent(marker);
                if (visibleParent && visibleParent._icon) {
                    const highlightClass = visibleParent.getChildCount ? 'highlight-cluster' : 'highlight-pin';
                    requestAnimationFrame(() => { if (visibleParent._icon) visibleParent._icon.classList.add(highlightClass); });
                    header.scrollIntoView({ behavior: 'smooth' });
                    setTimeout(() => { if (visibleParent._icon) visibleParent._icon.classList.remove('highlight-pin', 'highlight-cluster'); }, 4000);
                }
            };
        }

        const loader = document.getElementById('infinite-loader');
        if (loader) {
            feed.insertBefore(card, loader);
        } else {
            feed.appendChild(card);
        }
    });

    currentSliceIndex += nextBatch.length;
}
window.confirmDelete = (postId) => {
    if (confirm("Are you sure you want to delete this post?")) {
        deletePost(postId); // Calls your existing delete function
    }
};

let isLoading = false; // Add this global variable

document.getElementById('feed').addEventListener('scroll', async function() {
    const isNearBottom = this.scrollTop + this.clientHeight >= this.scrollHeight - 200;
    const hasMorePosts = currentSliceIndex < allFilteredPosts.length;

    if (isNearBottom && hasMorePosts && !isLoading) {
        isLoading = true; // Lock the trigger
        
        // Show the spinner
        const loader = document.getElementById('infinite-loader');
        if (loader) loader.style.display = 'block';

        // 1. THE DELAY (800ms)
        await new Promise(resolve => setTimeout(resolve, 800));

        // 2. LOAD DATA
        renderNextSlice();

        // 3. CLEANUP
        if (loader) loader.style.display = 'none';
        isLoading = false; // Unlock
    }
});

// 4. INTERACTION LISTENERS
document.addEventListener('scroll', (e) => {
    if (e.target.classList.contains('image-gallery')) {
        const gallery = e.target;
        const activeIndex = Math.round(gallery.scrollLeft / gallery.offsetWidth);
        const dots = gallery.parentElement.querySelectorAll('.gallery-dot');
        dots.forEach((dot, index) => dot.classList.toggle('active', index === activeIndex));
    }
}, true);

// 1. Set the load time when the script starts
const APP_LOAD_TIME = Date.now();

map.on('moveend', () => { 
    // GUARD 1: Ignore anything that happens in the first 2.5 seconds (initial locate)
    if (Date.now() - APP_LOAD_TIME < 1500) {
        return;
    }

    const visiblePosts = getVisiblePosts(); // Your existing filter function
    if (visiblePosts !== "TOO_FAR") {
        refreshMapMarkers(visiblePosts);
    }

    // GUARD 2: Ignore if we are currently clicking the "Recenter" button
    if (isReCentering) {
        return;
    }

    // If we passed the guards, show the button
    const updateBtn = document.getElementById('updateFeedBtn');
    if (updateBtn) {
        updateBtn.style.display = "block";
    }
    
    expandMapArea();
});

// Update the Recenter button to be more explicit
document.getElementById('recenterBtn').onclick = () => { 
    isReCentering = true; 
    // Trigger the locate
    map.locate({ setView: true, maxZoom: 14 }); 
    // Reset the re-centering flag after the map has had time to move
    setTimeout(() => { isReCentering = false; }, 3000); 
};

// Update Feed Button Click
document.getElementById('updateFeedBtn').onclick = () => {
    updateFeed(getVisiblePosts());
    document.getElementById('updateFeedBtn').style.display = "none";
};

let userMarker = null;

map.on('locationfound', (e) => {
    const { lat, lng } = e.latlng;
    window.userLatLng = e.latlng;

    // 1. Force the correct zoom (14) and save to storage
    map.setView(e.latlng, 14); 
    localStorage.setItem('lastLat', lat);
    localStorage.setItem('lastLng', lng);

    // 2. Hide the Gate UI
    const gate = document.getElementById('location-gate');
    if (gate) gate.style.display = 'none';

    // 3. Update User Marker
    if (window.userMarker) map.removeLayer(window.userMarker);
    window.userMarker = L.circleMarker(e.latlng, {
        radius: 6, color: '#ffffff', weight: 2, fillColor: '#ff3100', fillOpacity: 1
    }).addTo(map);

    // 4. Draw the "Spotlight"
    if (window.rangeCircle) map.removeLayer(window.rangeCircle);
    const worldBounds = [[90, -180], [90, 180], [-90, 180], [-90, -180]];
    const circlePoints = [];
    const numberOfPoints = 128; 
    const R = 6371000; 

    for (let i = 0; i <= numberOfPoints; i++) {
        const theta = (i / numberOfPoints) * (2 * Math.PI);
        const distRad = MAX_DISTANCE / R;
        const latRad = lat * (Math.PI / 180);
        const lonRad = lng * (Math.PI / 180);
        const pLatRad = Math.asin(Math.sin(latRad) * Math.cos(distRad) + Math.cos(latRad) * Math.sin(distRad) * Math.cos(theta));
        const pLonRad = lonRad + Math.atan2(Math.sin(theta) * Math.sin(distRad) * Math.cos(latRad), Math.cos(distRad) - Math.sin(latRad) * Math.sin(pLatRad));
        circlePoints.push([pLatRad * (180 / Math.PI), pLonRad * (180 / Math.PI)]);
    }

    window.rangeCircle = L.polygon([worldBounds, circlePoints], {
        color: 'transparent', fillColor: '#000000', fillOpacity: 0.6, interactive: false, smoothFactor: 0.1
    }).addTo(map);

    // 5. Final UI Refresh Logic
    const updateBtn = document.getElementById('updateFeedBtn');

    if (!isReCentering) {
        // Normal behavior: Update feed immediately
        updateFeed(getVisiblePosts());
    } else {
        // Re-center behavior: Don't jump the feed, but SHOW the button
        if (updateBtn) updateBtn.style.display = "block";
    }

    // Reset the flag after a short delay
    setTimeout(() => { 
        isReCentering = false; 
    }, 1000);
});
// 5. POST SUBMISSION
document.getElementById('submitPost').onclick = async () => {
    // 1. Distance Check (Keep this alert as it's a 'hard' global limit)
    const distFromUser = getDistance(
        window.userLatLng.lat, 
        window.userLatLng.lng, 
        postLatLng.lat, 
        postLatLng.lng
    );

    if (distFromUser > MAX_DISTANCE) {
        alert(`You can only post within ${MAX_DISTANCE/1000}km of your location!`);
        return;
    }

    // 2. Final Validation Check
    // Because the button is enabled, error SHOULD be null, 
    // but we check once more just in case a minute passed while the modal was open.
    const error = await getValidationErrors();
    if (error) {
        // Instead of a generic alert, we let our UI handle it
        await updateButtonStates(); 
        return; 
    }

    // 3. Setup Timestamps
    const isFuture = document.getElementById('isFuturePost').checked;
    let scheduledStartTime;

    if (isFuture) {
        const dateVal = document.getElementById('startDate').value;
        const timeVal = document.getElementById('startTime').value;
        scheduledStartTime = new Date(`${dateVal}T${timeVal}`).getTime();
    } else {
        scheduledStartTime = Date.now();
    }
    // --- HIERARCHY LOGIC ---
    let mediaFiles;
    const fileInput = document.getElementById('postImage');

    if (isReordered && currentMediaFiles.length > 0) {
        mediaFiles = currentMediaFiles;
    } else {
        mediaFiles = Array.from(fileInput.files);
    }

    const extractUniqueHashtags = (text) => {
        if (!text) return [];
        
        // Boundary-aware regex
        const hashtagRegex = /(?<=^|\s)#[a-zA-Z0-9_\u00C0-\u024F]+(?=$|\s|[.,!?:;])/g;
        const matches = text.match(hashtagRegex);
        if (!matches) return [];

        // Clean whitespace, drop '#', convert to lowercase, and remove duplicates
        const cleanTags = matches.map(tag => tag.trim().substring(1).toLowerCase());
        return [...new Set(cleanTags)];
    };
        
    const submitBtn = document.getElementById('submitPost');
    const previewBtn = document.getElementById('previewBtn');
    const modalContent = document.getElementById('postModal');
    const progressBar = document.getElementById('uploadProgressBar');
    const clearMediaBtn = document.querySelector('#media-lock-overlay button'); 
    const imageMode = document.getElementById('imageAspectRatio')?.value || 'portrait';
    
    const description = document.getElementById('postDescription').value.trim();
    const hashtagsArray = extractUniqueHashtags(`${description}`);
    const externalLink = document.getElementById('postLink').value.trim();
    const addressText = document.getElementById('address-display').innerText;
    const category = document.getElementById('postCategory').value;
    const subcategory = document.getElementById('postSubcategory').value;
    const lifespanHours = selectedLifespan;
    const authorId = getPulseUserId();

    // --- DISABLE INPUTS DURING UPLOAD ---
    submitBtn.disabled = true;
    submitBtn.innerText = "Posting...";
    if (previewBtn) previewBtn.disabled = true;
    if (fileInput) fileInput.disabled = true;
    if (clearMediaBtn) clearMediaBtn.disabled = true;

    progressBar.style.width = "5%";
    modalContent.style.pointerEvents = "none";

    let uploadedCount = 0;
    const totalFiles = mediaFiles.length;

    try {
        let mediaItems = [];
        
        mediaItems = await Promise.all(mediaFiles.map(async (file) => {
            const isVideo = file.type.startsWith('video/');
            
            if (file.size > 20 * 1024 * 1024) {
                throw new Error(`File ${file.name} is too large (Max 20MB)`);
            }

            // Inside submitPost
            const cleanFileName = file.name.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
            const storagePath = `media/${Date.now()}_${cleanFileName}`;
            const storageRef = sRef(storage, storagePath);
            
            const snapshot = await uploadBytes(storageRef, file);
            const url = await getDownloadURL(snapshot.ref);
            
            uploadedCount++;
            progressBar.style.width = `${5 + Math.floor((uploadedCount / totalFiles) * 80)}%`;

            // Save both the URL (for the browser) and the Path (for the Janitor)
            return { 
                url, 
                path: snapshot.ref.fullPath, // This is exactly what the Cloud Function needs
                type: isVideo ? 'video' : 'image' 
            };
        }));

        const dbRoot = ref(db, 'pulses');
        const newPulseRef = push(dbRoot); 
        const newPostId = newPulseRef.key; // Get the unique ID for logging

        console.log("🚀 Attempting to save new post with ID:", newPostId);

        // Retrieve saved custom profile details (if available)
        const customUsername = localStorage.getItem(`pulse_username_${authorId}`) || null;
        const customAvatar = localStorage.getItem(`pulse_avatar_${authorId}`) || null;

        // --- 3. ATOMIC DATA OBJECT ---
        const finalData = {
            description: description,
            hashtags: hashtagsArray,
            link: externalLink,
            category: category, 
            subcategory: subcategory, 
            address: addressText,
            imageMode: currentImageMode,
            type: isFuture ? 'Scheduled' : 'Live', 
            authorId: authorId,
            authorUsername: customUsername, // Stores "Kaffebrenneriet" or null
            authorAvatar: customAvatar,     // Stores Firebase Storage URL or null
            mediaItems: mediaItems || [],
            lifespanHours: Number(lifespanHours) || 24, // Force number type
            scheduledStartTime: Number(scheduledStartTime), 
            lat: parseFloat(postLatLng.lat), 
            lng: parseFloat(postLatLng.lng),
            createdAt: serverTimestamp() 
        };

        // --- 4. THE SAVE OPERATION ---
        // Ensure we are setting data on the CHILD (newPulseRef), not the ROOT (dbRoot)
        await set(newPulseRef, finalData);
        
        console.log("✅ Save successful!");

        // --- 5. UI CLEANUP ---
        progressBar.style.width = "100%";
        progressBar.style.backgroundColor = "#51CF66";
        submitBtn.innerText = "Done!";

        await new Promise(res => setTimeout(res, 800));
        window.closeModal();

    } catch (e) {
        console.error("Upload failed:", e);
        progressBar.style.backgroundColor = "#FF6B6B";
        alert(e.message || "Upload failed. Please try again.");
        
        // --- RE-ENABLE INPUTS ON ERROR ---
        submitBtn.disabled = false;
        submitBtn.innerText = "Post Now";
        modalContent.style.pointerEvents = "auto";
        if (previewBtn) previewBtn.disabled = false;
        if (fileInput) fileInput.disabled = false;
        if (clearMediaBtn) clearMediaBtn.disabled = false;
    }
};
async function updateAddressDisplay(lat, lng) {
    const display = document.getElementById('address-display');
    if (!display) return;
    clearTimeout(addressTimeout);
    
    addressTimeout = setTimeout(async () => {
        try {
            const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`);
            const data = await response.json();
            
            if (data.address) {
                const addr = data.address;

                // 1. Check for specific venue/POI names
                const venueName = data.name || 
                                  addr.amenity || 
                                  addr.shop || 
                                  addr.tourism || 
                                  addr.leisure || 
                                  addr.building || 
                                  addr.historic || 
                                  "";

                // 2. Fallback to street name if no venue name is found
                const street = addr.road || addr.pedestrian || "Unknown Street";

                // 3. District / Neighbourhood fallback
                const district = addr.suburb || 
                                 addr.neighbourhood || 
                                 addr.city_district || 
                                 addr.city || 
                                 addr.town || "";

                // Prioritize Venue Name over Street Name if available
                const primaryName = venueName ? venueName.trim() : street;

                // Store formatted string (split by comma for card logic)
                display.innerText = (district && district !== primaryName) 
                    ? `${primaryName}, ${district}` 
                    : primaryName;
            }
        } catch (error) { 
            display.innerText = "Location identified"; 
        }
    }, 500);
}
window.selectCategoryIcon = (cat) => {
    // 1. Update hidden input value
    const input = document.getElementById('postCategory');
    if (input) input.value = cat;

    // 2. Toggle active button styling
    document.querySelectorAll('.cat-icon-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.value === cat);
    });

    // 3. Trigger existing subcategory update function
    updateSubcategories();
};

// Existing subcategories update function remains unchanged!
window.updateSubcategories = () => {
    const mainCat = document.getElementById('postCategory').value;
    const subCatSelect = document.getElementById('postSubcategory');
    if (!subCatSelect) return;
    
    subCatSelect.disabled = false;
    const options = categoryMap[mainCat] || ["General"];
    subCatSelect.innerHTML = options.map(sub => `<option value="${sub}">${sub}</option>`).join('');
};
// Local Storage Helper Functions
function getSavedLocations() {
    return JSON.parse(localStorage.getItem('user_saved_locations')) || [];
}

window.saveCurrentMiniMapLocation = function() {
    if (!postLatLng || !postLatLng.lat) {
        alert("Location is not ready yet.");
        return;
    }

    const currentAddress = document.getElementById('address-display').innerText.replace('Pinpointing location...', '').trim() || "Saved Spot";
    const locationName = prompt("Name this location:", currentAddress.split(',')[0] || "My Spot");

    if (!locationName) return; // User canceled

    const savedList = getSavedLocations();
    const newSpot = {
        id: 'spot_' + Date.now(),
        name: locationName,
        lat: postLatLng.lat,
        lng: postLatLng.lng,
        address: currentAddress
    };

    savedList.push(newSpot);
    localStorage.setItem('user_saved_locations', JSON.stringify(savedList));
    
    // Refresh dropdown options
    populateSavedLocationsDropdown();
    alert(`Saved "${locationName}"!`);
};
window.deleteSelectedSavedLocation = function() {
    const selectEl = document.getElementById('savedLocationsSelect');
    const selectedId = selectEl ? selectEl.value : null;

    if (!selectedId) return;

    const savedList = getSavedLocations();
    const spotToDelete = savedList.find(s => s.id === selectedId);

    if (!spotToDelete) return;

    const confirmDelete = confirm(`Are you sure you want to delete "${spotToDelete.name}"?`);
    if (!confirmDelete) return;

    // Filter out the deleted location and update localStorage
    const updatedList = savedList.filter(s => s.id !== selectedId);
    localStorage.setItem('user_saved_locations', JSON.stringify(updatedList));

    // Refresh dropdown and disable delete button
    populateSavedLocationsDropdown();
    
    // Optionally trigger snap back or leave map where it is
    const deleteBtn = document.getElementById('deleteSavedLocationBtn');
    if (deleteBtn) {
        deleteBtn.disabled = true;
        deleteBtn.style.opacity = "0.5";
    }
};

// Updated applySavedLocation to activate the Trash Button when a spot is chosen
window.applySavedLocation = function(spotId) {
    const savedList = getSavedLocations();
    const spot = savedList.find(s => s.id === spotId);

    if (spot && miniMap) {
        isProgrammaticMove = true;
        postLatLng = { lat: spot.lat, lng: spot.lng };
        
        miniMap.panTo([spot.lat, spot.lng], { animate: true });
        if (miniMarker) miniMarker.setLatLng([spot.lat, spot.lng]);
        updateAddressDisplay(spot.lat, spot.lng);

        // Enable trash delete button
        const deleteBtn = document.getElementById('deleteSavedLocationBtn');
        if (deleteBtn) {
            deleteBtn.disabled = false;
            deleteBtn.style.opacity = "1";
        }

        setTimeout(() => {
            isProgrammaticMove = false;
        }, 300);
    }
};

// Updated populateSavedLocationsDropdown to handle trash button state on reset
window.populateSavedLocationsDropdown = function() {
    const selectEl = document.getElementById('savedLocationsSelect');
    const deleteBtn = document.getElementById('deleteSavedLocationBtn');
    if (!selectEl) return;

    const savedList = getSavedLocations();

    // Disable trash icon on populate reset
    if (deleteBtn) {
        deleteBtn.disabled = true;
        deleteBtn.style.opacity = "0.5";
    }

    if (savedList.length === 0) {
        selectEl.innerHTML = `<option value="" disabled selected>No saved locations yet</option>`;
        selectEl.disabled = true;
        return;
    }

    selectEl.disabled = false;
    selectEl.innerHTML = `<option value="" disabled selected>-- Select a saved spot (${savedList.length}) --</option>` + 
        savedList.map(spot => `<option value="${spot.id}">${spot.name} (${spot.address.split(',')[0]})</option>`).join('');
};
document.getElementById('snapToLocation').onclick = (e) => {
    e.stopPropagation();
    if (!miniMap || !window.userLatLng) return;

    const jitter = () => (Math.random() - 0.5) * 0.0015;
    
    // Instead of raw locate, we fly to a fuzzed version of their known location
    const fuzzedLat = window.userLatLng.lat + jitter();
    const fuzzedLng = window.userLatLng.lng + jitter();

    miniMap.flyTo([fuzzedLat, fuzzedLng], 15, { duration: 0.8 });
    
    // Update the saved coordinates immediately
    postLatLng = { lat: fuzzedLat, lng: fuzzedLng };
    miniMarker.setLatLng([fuzzedLat, fuzzedLng]);
};
// Helper to draw the dark mask on the miniMap
const drawMiniMask = (lat, lng) => {
    if (window.miniRangeCircle) miniMap.removeLayer(window.miniRangeCircle);

    const worldBounds = [[90, -180], [90, 180], [-90, 180], [-90, -180]];
    const circlePoints = [];
    const numberOfPoints = 128;
    const R = 6371000;

    for (let i = 0; i <= numberOfPoints; i++) {
        const theta = (i / numberOfPoints) * (2 * Math.PI);
        const distRad = MAX_DISTANCE / R;
        const latRad = lat * (Math.PI / 180);
        const lonRad = lng * (Math.PI / 180);

        const pLatRad = Math.asin(Math.sin(latRad) * Math.cos(distRad) +
                        Math.cos(latRad) * Math.sin(distRad) * Math.cos(theta));
        const pLonRad = lonRad + Math.atan2(Math.sin(theta) * Math.sin(distRad) * Math.cos(latRad),
                         Math.cos(distRad) - Math.sin(latRad) * Math.sin(pLatRad));

        circlePoints.push([pLatRad * (180 / Math.PI), pLonRad * (180 / Math.PI)]);
    }

    window.miniRangeCircle = L.polygon([worldBounds, circlePoints], {
        color: 'transparent',
        fillColor: '#000000',
        fillOpacity: 0.6,
        interactive: false,
        smoothFactor: 0.1
    }).addTo(miniMap);
};
function resetModal() {
    currentStep = 1;
    updateModalSteps();
    const modal = document.getElementById('postModal');
    const submitBtn = document.getElementById('submitPost');
    const previewBtn = document.getElementById('previewBtn');
    const fileInput = document.getElementById('postImage');
    const clearMediaBtn = document.querySelector('#media-lock-overlay button');
    const progressBar = document.getElementById('uploadProgressBar');
    const mediaOverlay = document.getElementById('media-lock-overlay');

    // 1. Re-enable interactions
    modal.style.pointerEvents = "auto";
    
    // 2. Reset Buttons
    submitBtn.disabled = true; 
    submitBtn.innerText = "Post Now";
    if (previewBtn) previewBtn.disabled = true;

    // 3. Reset Media Inputs & UI
    if (clearMediaBtn) clearMediaBtn.disabled = false;
    if (fileInput) {
        fileInput.disabled = false;
        fileInput.value = '';
    }
    if (mediaOverlay) mediaOverlay.style.display = 'none';
    progressBar.style.width = "0%";
    progressBar.style.backgroundColor = "#ff3100";

    // 4. --- NEW: RESET LIVE/FUTURE MODE ---
    if (typeof window.setPostMode === 'function') {
        window.setPostMode('live');
    }

    const dateInput = document.getElementById('startDate');
    const timeInput = document.getElementById('startTime'); // If you have a time input
    
    if (dateInput) {
        // Reset to empty so it shows the placeholder/browser default
        dateInput.value = ''; 
        // Or if you prefer it to default to today:
        // dateInput.value = new Date().toISOString().split('T')[0];
    }
    
    if (timeInput) {
        timeInput.value = ''; // Resets the time field
    }

    // 6. --- RESET ORIENTATION ---
    currentImageMode = 'portrait'; 
    const portBtn = document.getElementById('mode-portrait');
    const landBtn = document.getElementById('mode-landscape');
    if (portBtn && landBtn) {
        portBtn.classList.add('active');
        landBtn.classList.remove('active');
    }

    // 7. Reset Variables & UI
    isReordered = false;
    currentMediaFiles = [];
    selectedLifespan = 24; 
    
    document.querySelectorAll('.lifespan-btn').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.getAttribute('data-value')) === 24);
    });
    
    updateButtonStates();
}
const textarea = document.getElementById('postDescription');
const counter = document.getElementById('char-counter');
const maxLength = 280;

if (textarea) {
    textarea.addEventListener('input', function() {
        const currentLength = this.value.length;
        if (counter) counter.textContent = `${currentLength} / ${maxLength}`;

        // Hide description error display
        const descError = document.getElementById('desc-error-display');
        if (descError) descError.style.display = "none";
        
        // Auto-expand textarea height
        this.style.height = "auto";
        this.style.height = (this.scrollHeight) + "px";

        // Counter limit styling
        if (counter) {
            counter.classList.toggle('near-limit', currentLength > maxLength * 0.85);
            counter.classList.toggle('at-limit', currentLength >= maxLength);
        }

        // --- 1. SYNC SUGGESTED TAG BUTTON STATES (DISABLE/GREY OUT) ---
        syncSuggestedTagButtons(this.value);

        // --- 2. AUTOMATICALLY DETECT DUPLICATE HASHTAGS WHILE TYPING ---
        detectDuplicateHashtags(this.value);
    });
}
// Function to disable/grey out suggested tag buttons if their tag is in the text
function syncSuggestedTagButtons(text) {
    const buttons = document.querySelectorAll('#suggestedTagsContainer button');
    const lowerText = (text || '').toLowerCase();

    buttons.forEach(btn => {
        const tag = (btn.getAttribute('data-tag') || btn.textContent).trim().toLowerCase();
        
        // Simple, clean check: Is the hashtag inside the description?
        const isPresent = tag && lowerText.includes(tag);

        if (isPresent) {
            // Disable & Grey Out
            btn.disabled = true;
            btn.style.opacity = '0.4';
            btn.style.filter = 'grayscale(100%)';
            btn.style.cursor = 'not-allowed';
            btn.style.background = 'rgba(148, 163, 184, 0.15)';
            btn.style.borderColor = 'rgba(148, 163, 184, 0.3)';
            btn.style.color = '#94a3b8';
            btn.style.pointerEvents = 'none'; // Extra guard against clicks
        } else {
            // Re-enable & Restore Style
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.filter = 'none';
            btn.style.cursor = 'pointer';
            btn.style.background = 'rgba(37, 99, 235, 0.15)';
            btn.style.borderColor = 'rgba(37, 99, 235, 0.3)';
            btn.style.color = '#3b82f6';
            btn.style.pointerEvents = 'auto';
        }
    });
}

function detectDuplicateHashtags(text) {
    const hashtagRegex = /(?<=^|\s)#[a-zA-Z0-9_\u00C0-\u024F]+(?=$|\s|[.,!?:;])/g;
    const matches = text.match(hashtagRegex);
    let descError = document.getElementById('description-error-display');
    
    if (matches) {
        const lowerTags = matches.map(t => t.trim().toLowerCase());
        const duplicates = lowerTags.filter((item, index) => lowerTags.indexOf(item) !== index);
        
        if (duplicates.length > 0 && descError) {
            const uniqueDup = [...new Set(duplicates)][0];
            descError.textContent = `Duplicate tag detected: ${uniqueDup}`;
            descError.style.display = "block";
            return true;
        }
    }
    
    // Clear warning if no duplicate tags exist
    if (descError && descError.textContent.startsWith('Duplicate tag')) {
        descError.style.display = "none";
    }
    return false;
}
// 1. Move these to the very top of your script.js (outside any other functions)
let currentStep = 1;

window.nextStep = async function() {
    if (currentStep === 1) {
        currentStep = 2;
        updateModalSteps();
        updateButtonStates(); // Keep buttons in sync
    } 
    else if (currentStep === 2) {
        const error = await getValidationErrors();
        const descError = document.getElementById('desc-error-display');
        const mediaInfo = document.getElementById('media-info-display');
        
        // Reset Text Error
        if (descError) descError.style.display = "none";

        // Only stop if the error belongs on THIS page (Media or Text)
        if (error && (error.type === 'media' || error.type === 'text')) {
            if (error.type === 'media' && mediaInfo) {
                mediaInfo.innerText = error.message;
                mediaInfo.style.color = "#ff3100"; // Red for errors
            } else if (error.type === 'text' && descError) {
                descError.innerText = error.message;
                descError.style.display = "block";
            }
            return; // Stop the user from proceeding
        }

        // If it's a schedule error (Step 3 problem) or no error, proceed
        currentStep = 3;
        updateModalSteps();
        updateButtonStates(); // Keep UI in sync
    }
};

window.prevStep = function() {
    if (currentStep > 1) {
        currentStep--;
        updateModalSteps();
        updateButtonStates(); // Force a re-check of the button state for the new step
    }
};
window.updateModalSteps = function() {
    // Hide all steps
    document.querySelectorAll('.modal-step').forEach(s => s.style.display = 'none');
    
    // UI Buttons
    const backBtn = document.getElementById('modalBackBtn');
    const cancelBtn = document.getElementById('modalCancelBtn');
    const nextBtn = document.getElementById('modalNextBtn');
    const submitBtn = document.getElementById('submitPost');
    const previewBtn = document.getElementById('previewBtn');

    if (currentStep === 1) {
        document.getElementById('step-location').style.display = 'block';
        if(backBtn) backBtn.style.display = 'none';
        if(cancelBtn) cancelBtn.style.display = 'block';
        if(nextBtn) nextBtn.style.display = 'block';
        if(submitBtn) submitBtn.style.display = 'none';
        if(previewBtn) previewBtn.style.display = 'none';
        
        // Refresh map layout since it was hidden
        if (typeof miniMap !== 'undefined' && miniMap) {
            setTimeout(() => miniMap.invalidateSize(), 100);
        }
    } 
    else if (currentStep === 2) {
        document.getElementById('step-content').style.display = 'block';
        if(backBtn) backBtn.style.display = 'block';
        if(cancelBtn) cancelBtn.style.display = 'none';
        if(nextBtn) nextBtn.style.display = 'block';
        if(submitBtn) submitBtn.style.display = 'none';
        if(previewBtn) previewBtn.style.display = 'none';
    } 
    else if (currentStep === 3) {
        document.getElementById('step-details').style.display = 'block';
        if(backBtn) backBtn.style.display = 'block';
        if(cancelBtn) cancelBtn.style.display = 'none';
        if(nextBtn) nextBtn.style.display = 'none';
        if(submitBtn) submitBtn.style.display = 'block';
        if(previewBtn) previewBtn.style.display = 'block';
    }
    updateButtonStates();
};
// Flag to differentiate manual user drags from programmatic dropdown positioning
let isProgrammaticMove = false;

document.getElementById('addPostBtn').onclick = () => {
    // 1. UI Reset & Shielding
    resetModal();
    const overlay = document.getElementById('modal-overlay');
    const modal = document.getElementById('postModal');
    document.body.classList.add('no-scroll');
    
    // Prevent background scrolling and clicks to bottom-nav
    document.body.style.overflow = 'hidden';
    overlay.style.display = "block";
    modal.style.display = "flex";

    // --- POPULATE DYNAMIC POPULAR TAGS ---
    renderPopularTags();

    // 2. Clear Form States
    document.getElementById('postDescription').value = '';
    document.getElementById('postCategory').value = "";
    const subCatSelect = document.getElementById('postSubcategory');
    subCatSelect.value = "General";
    subCatSelect.disabled = true;
    document.getElementById('postImage').value = '';
    
    // --- 2b. POPULATE SAVED LOCATIONS DROPDOWN ---
    if (typeof populateSavedLocationsDropdown === 'function') {
        populateSavedLocationsDropdown();
    }

    // 3. Trigger Animation
    requestAnimationFrame(() => {
        modal.classList.add('slide-up');
    });

    updateButtonStates();
    updateSubcategories();

    // 4. Privacy Fuzzing Logic
    if (window.userLatLng && window.userLatLng.lat) {
        const jitter = () => (Math.random() - 0.5) * 0.0016; 
        postLatLng = { 
            lat: window.userLatLng.lat + jitter(), 
            lng: window.userLatLng.lng + jitter() 
        };
    } else {
        postLatLng = { lat: 55.6761, lng: 12.5683 }; 
    }
    
    // 5. MiniMap Initialization (Wait for slide-up to stabilize)
    setTimeout(() => {
        // Initialize auto-populated Oslo search listener
        setupOsloVenueSearch();
        if (!miniMap) {
            miniMap = L.map('miniMap', { zoomControl: false, attributionControl: false })
                .setView([postLatLng.lat, postLatLng.lng], 15);
            
            L.tileLayer(`https://tiles.stadiamaps.com/tiles/osm_bright/{z}/{x}/{y}{r}.png?api_key=${STADIA_API_KEY}`, {
                maxZoom: 20,
                crossOrigin: true,
            }).addTo(miniMap);

            miniMarker = L.marker([postLatLng.lat, postLatLng.lng], { interactive: false }).addTo(miniMap);

            miniMap.on('move', () => {
                const newCenter = miniMap.getCenter();
                const dist = getDistance(window.userLatLng.lat, window.userLatLng.lng, newCenter.lat, newCenter.lng);

                if (dist > MAX_DISTANCE) {
                    miniMap.panTo([postLatLng.lat, postLatLng.lng], { animate: false });
                    return; 
                }

                miniMarker.setLatLng(newCenter);
                postLatLng = { lat: newCenter.lat, lng: newCenter.lng };
                updateAddressDisplay(newCenter.lat, newCenter.lng);

                // --- UNSELECT SAVED LOCATION DROPDOWN IF MANUALLY DRAGGED ---
                if (!isProgrammaticMove) {
                    const selectEl = document.getElementById('savedLocationsSelect');
                    if (selectEl) selectEl.selectedIndex = 0;

                    // Disable trash button when unselected by map drag
                    const deleteBtn = document.getElementById('deleteSavedLocationBtn');
                    if (deleteBtn) {
                        deleteBtn.disabled = true;
                        deleteBtn.style.opacity = "0.5";
                    }
                }
            });
        } else {
            miniMap.setView([postLatLng.lat, postLatLng.lng], 15);
            miniMarker.setLatLng([postLatLng.lat, postLatLng.lng]);
            miniMap.invalidateSize();
        }

        drawMiniMask(window.userLatLng.lat, window.userLatLng.lng);
        updateAddressDisplay(postLatLng.lat, postLatLng.lng);
    }, 350); // Matches the CSS transition time
};

window.setPostMode = function(mode) {
    const liveBtn = document.getElementById('mode-live');
    const futureBtn = document.getElementById('mode-future');
    const futureInputs = document.getElementById('future-inputs');
    const futureCheckbox = document.getElementById('isFuturePost');
    const dateInput = document.getElementById('startDate');
    const timeInput = document.getElementById('startTime');

    if (!futureCheckbox || !liveBtn || !futureBtn) return;

    if (mode === 'future') {
        // 1. UI Styling (Active Future Mode)
        futureBtn.style.background = "#ff3100";
        futureBtn.style.color = "white";
        futureBtn.style.borderColor = "#ff3100";
        
        liveBtn.style.background = "white";
        liveBtn.style.color = "#64748b";
        liveBtn.style.borderColor = "#e2e8f0";

        if (futureInputs) futureInputs.style.display = 'flex';
        futureCheckbox.checked = true;

        // 2. Set Date/Time Constraints
        if (dateInput && timeInput) {
            const now = new Date();
            
            // Default to Tomorrow at 12:00
            const tomorrow = new Date(now);
            tomorrow.setDate(now.getDate() + 1);

            // Max limit (10 days from now)
            const maxDate = new Date(now);
            maxDate.setDate(now.getDate() + 10);

            // Format YYYY-MM-DD for HTML attributes using local offset
            const offset = now.getTimezoneOffset() * 60000;
            const minStr = (new Date(now - offset)).toISOString().split('T')[0];
            const maxStr = (new Date(maxDate - offset)).toISOString().split('T')[0];
            const tomorrowStr = (new Date(tomorrow - offset)).toISOString().split('T')[0];

            // Apply calendar picker limits
            dateInput.min = minStr;
            dateInput.max = maxStr;

            // 3. Set Defaults (only if empty)
            if (!dateInput.value) {
                dateInput.value = tomorrowStr;
            }
            if (!timeInput.value) {
                timeInput.value = "12:00";
            }
        }

    } else {
        // 4. Reset to Live Mode Styling
        liveBtn.style.background = "#ff3100";
        liveBtn.style.color = "white";
        liveBtn.style.borderColor = "#ff3100";
        
        futureBtn.style.background = "white";
        futureBtn.style.color = "#64748b";
        futureBtn.style.borderColor = "#e2e8f0";

        if (futureInputs) futureInputs.style.display = 'none';
        futureCheckbox.checked = false;

        // 5. Clear values to prevent hidden "Past Date" errors in getValidationErrors
        if (dateInput) dateInput.value = '';
        if (timeInput) timeInput.value = '';
    }

    // 6. Trigger validation update (re-checks all buttons)
    futureCheckbox.dispatchEvent(new Event('change'));
};
// State variable
let selectedLifespan = 24; 

document.getElementById('lifespan-container').addEventListener('click', (e) => {
    const btn = e.target.closest('.lifespan-btn');
    if (!btn) return;

    document.querySelectorAll('.lifespan-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedLifespan = parseInt(btn.getAttribute('data-value'));
});

window.closeModal = () => {
    const modal = document.getElementById('postModal');
    const overlay = document.getElementById('modal-overlay'); // The "Shield"
    
    // 1. Start the Slide-Down Animation
    modal.classList.remove('slide-up');
    
    // 2. Re-enable background interaction
    document.body.classList.remove('modal-open');
    document.body.style.overflow = ''; 

    // 3. Wait for the CSS transition (400ms) before hiding the physical elements
    setTimeout(() => {
        // Reset the "Shield" and Modal display
        if (overlay) overlay.style.display = "none";
        modal.style.display = "none";

        // --- RESET ALL MEDIA LOGIC ---
        window.clearMediaSelection();

        // --- RESET PROGRESS BAR ---
        const progressBar = document.getElementById('uploadProgressBar');
        if (progressBar) {
            progressBar.style.width = "0%";
            progressBar.style.backgroundColor = "#ff3100"; 
        }

        // --- CLEAR PREVIEW & TEXT ---
        const previewContent = document.getElementById('previewContent');
        if (previewContent) previewContent.innerHTML = '';
        const postDescription = document.getElementById('postDescription');
        const postLink = document.getElementById('postLink');
        
        if (postDescription) postDescription.value = '';
        if (postLink) postLink.value = '';

        document.getElementById('postCategory').value = "";
        
        // --- RESET SUGGESTED HASHTAG BUTTON STATES ---
        if (typeof syncSuggestedTagButtons === 'function') {
            syncSuggestedTagButtons('');
        } else {
            // Fallback manual reset if helper function isn't in scope
            document.querySelectorAll('#suggestedTagsContainer button').forEach(btn => {
                btn.disabled = false;
                btn.style.opacity = '1';
                btn.style.filter = 'none';
                btn.style.cursor = 'pointer';
                btn.style.background = 'rgba(37, 99, 235, 0.15)';
                btn.style.borderColor = 'rgba(37, 99, 235, 0.3)';
                btn.style.color = '#3b82f6';
                btn.style.pointerEvents = 'auto';
            });
        }

        // --- RESET CHARACTER COUNTER ---
        const charCounter = document.getElementById('char-counter');
        if (charCounter) {
            charCounter.innerText = '0 / 280';
            charCounter.style.color = '#64748b'; // Reset to neutral grey
        }
        
        // --- RESET ERROR DISPLAYS ---
        const mediaInfo = document.getElementById('media-info-display');
        const descError = document.getElementById('desc-error-display');
        
        if (mediaInfo) {
            mediaInfo.innerText = "Max 3 images and 1 video (15s limit).";
            mediaInfo.style.color = "#007AFF";
        }
        if (descError) descError.style.display = "none";

        // --- RESET SELECTS ---
        const subCatSelect = document.getElementById('postSubcategory');
        subCatSelect.innerHTML = '<option value="General">General</option>';
        subCatSelect.disabled = true;

        // --- RESET LIFESPAN ---
        selectedLifespan = 24;
        document.querySelectorAll('.lifespan-btn').forEach(btn => {
            btn.classList.toggle('active', parseInt(btn.getAttribute('data-value')) === 24);
        });

        const scheduleError = document.getElementById('schedule-error-display');
        if (scheduleError) {
            scheduleError.style.display = 'none';
            scheduleError.innerText = '';
        }
        document.getElementById('startDate').value = '';
        document.getElementById('startTime').value = '';
        
        // --- RESET BUTTON STATES ---
        const submitBtn = document.getElementById('submitPost');
        const previewBtn = document.getElementById('previewBtn');
        const backBtn = document.getElementById('modalBackBtn');
        
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerText = "Post Now";
            submitBtn.style.opacity = "0.5";
        }
        if (previewBtn) {
            previewBtn.disabled = true;
            previewBtn.style.opacity = "0.5";
        }
        if (backBtn) {
            backBtn.disabled = false;
            backBtn.style.opacity = "1";
        }

        modal.style.pointerEvents = "auto";
        
        // Final sync to ensure the "Next" button is ready for the next opening
        updateButtonStates();
        document.body.classList.remove('no-scroll');
    }, 400); 
};

window.closePreview = () => {
    const previewModal = document.getElementById('previewModal');
    previewModal.classList.remove('slide-up');
    
    setTimeout(() => {
        previewModal.style.display = 'none';
        // DO NOT revokeObjectURL here!
        // Just clear the HTML to stop videos from playing in the background
        document.getElementById('previewContent').innerHTML = '';
    }, 400);
};

window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const previewModal = document.getElementById('previewModal');
        if (previewModal.style.display === 'block') {
            closePreview(); // Close preview first
        } else {
            window.closeModal(); // Close post modal second
        }
    }
});

document.querySelectorAll('.filter-btn:not(.toggle-map-btn)').forEach(btn => {
    btn.onclick = (e) => {
        const clickedBtn = e.currentTarget;
        
        // UI Update
        document.querySelectorAll('.filter-btn:not(.toggle-map-btn)').forEach(b => b.classList.remove('active'));
        clickedBtn.classList.add('active');
        
        // Data Update
        currentCategory = clickedBtn.getAttribute('data-category');

        // SYNC EVERYTHING (Map + Feed)
        if (typeof syncAppView === 'function') {
            syncAppView();
        }
    };
});

function getIcon(category) {
    const colors = { "Food": "#FF6B6B", "Art": "#4D96FF", "Music": "#9D50BB", "Urban": "#FF922B", "Community": "#868E96", "Nature": "#51CF66" };
    return L.divIcon({ className: "custom-pin", html: `<svg viewBox="0 0 24 24" width="30" height="30" fill="${colors[category] || "#333"}" stroke="white" stroke-width="1.5"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"></path><circle cx="12" cy="9" r="2.5" fill="white"></circle></svg>`, iconSize: [30, 30], iconAnchor: [15, 30], popupAnchor: [0, -30] });
}

function getFormattedTime(post) {
    // We use createdAt because it represents when the user actually "Pulsed" it.
    const startTimeTs = post.createdAt || post.scheduledStartTime || Date.now();
    const now = Date.now();
    const diffMs = now - startTimeTs;

    // Convert to seconds
    const diffSec = Math.floor(diffMs / 1000);
    
    // 1. Just now (less than 1 minute)
    if (diffSec < 60) return "just now";

    // 2. Minutes (less than 1 hour)
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;

    // 3. Hours (less than 24 hours)
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}h ago`;

    // 4. Days
    const diffDay = Math.floor(diffHour / 24);
    return `${diffDay}d ago`;
}

function updateCounter(count) {
    const counter = document.getElementById('feed-counter');
    if (!counter) return;

    let displayCount;

    if (count >= 1000) {
        // Divide by 1000 and round to 1 decimal place (e.g., 1.5)
        const thousands = count / 1000;
        
        // .replace(/\.0$/, '') removes the ".0" if it's a whole number (e.g., 1.0k -> 1k)
        displayCount = thousands.toFixed(1).replace(/\.0$/, '') + 'k';
    } else {
        displayCount = count;
    }

    counter.innerText = displayCount;
}

function expandMapArea() {
    const header = document.querySelector('header');
    const MAX_HEIGHT = 450;
    
    header.style.transition = "height 0.5s cubic-bezier(0.19, 1, 0.22, 1)";
    header.style.height = `${MAX_HEIGHT}px`;

    setTimeout(() => {
        if (typeof map !== 'undefined') map.invalidateSize({ animate: true });
    }, 500);
}
window.openPreview = async () => {
    const error = await getValidationErrors();
    if (error) return alert(error);
    
    const fileInput = document.getElementById('postImage');

    if (!isReordered || currentMediaFiles.length === 0) {
        currentMediaFiles = Array.from(fileInput.files);
    }

    const previewModal = document.getElementById('previewModal');
    const previewContent = document.getElementById('previewContent');
    
    // --- 1. ASPECT RATIO SELECTOR UI ---
    const currentMode = currentImageMode;
    const selectorHtml = `
        <div style="padding: 15px; background: #1a1a1a; border-radius: 12px; margin-bottom: 15px;">
            <div style="display: flex; gap: 10px;">
                <button onclick="updatePreviewCrop('portrait')" id="btn-portrait" 
                    style="flex: 1; padding: 10px; border-radius: 8px; border: 1px solid ${currentMode === 'portrait' ? '#ff3100' : '#333'}; background: ${currentMode === 'portrait' ? '#ff31001a' : '#222'}; color: ${currentMode === 'portrait' ? '#ff3100' : '#888'}; cursor: pointer; font-size: 13px; font-weight: 600;">
                    Portrait (3:4)
                </button>
                <button onclick="updatePreviewCrop('landscape')" id="btn-landscape" 
                    style="flex: 1; padding: 10px; border-radius: 8px; border: 1px solid ${currentMode === 'landscape' ? '#ff3100' : '#333'}; background: ${currentMode === 'landscape' ? '#ff31001a' : '#222'}; color: ${currentMode === 'landscape' ? '#ff3100' : '#888'}; cursor: pointer; font-size: 13px; font-weight: 600;">
                    Landscape (4:3)
                </button>
            </div>
        </div>
    `;

    // --- 2. GALLERY HTML GENERATION ---
    let galleryHtml = '';
    if (currentMediaFiles.length > 0) {
        const modeClass = currentMode === 'landscape' ? 'mode-landscape' : 'mode-portrait';
        
        const itemsHtml = currentMediaFiles.map(file => {
            if (!file._previewUrl) file._previewUrl = URL.createObjectURL(file);
            const url = file._previewUrl;
            const isVideo = file.type.startsWith('video/');
            return isVideo 
                ? `<video src="${url}" muted loop playsinline autoplay style="width:100%; height:100%; object-fit:cover;"></video>`
                : `<img src="${url}" style="width:100%; height:100%; object-fit:cover;">`;
        }).join('');
        
        galleryHtml = `
        <div id="preview-gallery-wrapper" class="post-card-image-wrapper ${modeClass}">
            <div class="image-gallery">${itemsHtml}</div>
            ${currentMediaFiles.length > 1 ? `<div class="gallery-dots">${currentMediaFiles.map((_, i) => `<span class="gallery-dot ${i === 0 ? 'active' : ''}"></span>`).join('')}</div>` : ''}
        </div>`;
    }

    // --- 3. REORDER THUMBNAILS ---
    const reorderHtml = currentMediaFiles.length > 0 ? `
    <div id="reorder-container" style="margin-top:10px; padding:10px; background:#f0f0f0; border-radius:8px;">
        <div id="media-thumbnails" style="display:flex; gap:10px; padding:10px; overflow-x:auto; scrollbar-width: none;">
            ${currentMediaFiles.map((file, index) => {
                const isVideo = file.type.startsWith('video/');
                
                const thumbContent = isVideo 
                    ? `<div style="width:100%; height:100%; background:#333; display:flex; align-items:center; justify-content:center; border-radius:4px; font-size:18px;">🎬</div>`
                    : `<img src="${file._previewUrl}" style="width:100%; height:100%; object-fit:cover; border-radius:4px;">`;

                return `
                    <div class="thumb" data-index="${index}" style="position:relative; width:50px; height:50px; flex-shrink:0; cursor:grab; touch-action:none;">
                        ${thumbContent}
                        <div onclick="removeFileFromPreview(${index})" style="position:absolute; top:-6px; right:-6px; background:#ff4d4d; color:white; border-radius:50%; width:18px; height:18px; display:flex; align-items:center; justify-content:center; cursor:pointer; z-index:10; box-shadow: 0 1px 3px rgba(0,0,0,0.2);">
                            <svg width="8" height="8" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M1 1L11 11M1 11L11 1" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
        <button id="confirm-reorder" disabled style="margin-top:10px; padding:10px; border-radius:8px; border:none; background:#ff3100; color:white; opacity:0.3; cursor:pointer; font-weight: 600;">
            Apply Changes
        </button>
    </div>` : '';

    // --- 4. DESCRIPTION PREVIEW WITH BLUE NON-CLICKABLE HASHTAGS ---
    const descInput = document.getElementById('postDescription');
    const descText = descInput ? descInput.value.trim() : '';
    let descriptionPreviewHtml = '';

    if (descText) {
        // Safe HTML escaping
        let escapedText = descText
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        // Boundary regex: Requires space/start before # and space/end/punctuation after
        const validHashtagRegex = /(?<=^|\s)#[a-zA-Z0-9_\u00C0-\u024F]+(?=$|\s|[.,!?:;])/g;

        const highlightedText = escapedText.replace(validHashtagRegex, (match) => {
            return `<span style="color: #3b82f6; font-weight: 600; cursor: default;">${match}</span>`;
        });

        descriptionPreviewHtml = `
            <div class="preview-description-card" style="
                margin-top: 12px;
                padding: 12px 14px;
                background: #1a1d23;
                border: 1px solid #2d333b;
                border-radius: 10px;
                color: #eeeeee;
                font-size: 13px;
                line-height: 1.5;
                word-break: break-word;
                text-align: left;
            ">
                ${highlightedText}
            </div>
        `;
    }

    // Combine everything into previewContent
    previewContent.innerHTML = selectorHtml + galleryHtml + descriptionPreviewHtml + reorderHtml;
    
    if (currentMediaFiles.length > 1) initReorderLogic();

    previewModal.style.display = "flex";
    requestAnimationFrame(() => previewModal.classList.add('slide-up'));
};
window.updatePreviewCrop = (mode) => {
    // 1. Update the persistent global state
    currentImageMode = mode;

    const wrapper = document.getElementById('preview-gallery-wrapper');
    const btnP = document.getElementById('btn-portrait');
    const btnL = document.getElementById('btn-landscape');

    if (!wrapper) return;

    // 2. UI Updates (Same as before)
    if (mode === 'landscape') {
        wrapper.classList.replace('mode-portrait', 'mode-landscape');
        btnL.style.borderColor = "#ff3100"; btnL.style.color = "#ff3100"; btnL.style.background = "#ff31001a";
        btnP.style.borderColor = "#333"; btnP.style.color = "#888"; btnP.style.background = "#222";
    } else {
        wrapper.classList.replace('mode-landscape', 'mode-portrait');
        btnP.style.borderColor = "#ff3100"; btnP.style.color = "#ff3100"; btnP.style.background = "#ff31001a";
        btnL.style.borderColor = "#333"; btnL.style.color = "#888"; btnL.style.background = "#222";
    }
};
window.removeFileFromPreview = (index) => {
    isReordered = true;
    currentMediaFiles.splice(index, 1);

    // 1. If everything is deleted, run the full clear
    if (currentMediaFiles.length === 0) {
        window.closePreview();
        window.clearMediaSelection();
        return;
    }

    // 2. Refresh the Lock UI (The grey box over the input)
    const lockText = document.getElementById('lock-text');
    if (lockText) {
        const count = currentMediaFiles.length;
        lockText.innerText = `${count} file${count !== 1 ? 's' : ''} selected`;
    }

    // 3. Sync the Green Success Message
    if (window.syncMediaStatusUI) {
        window.syncMediaStatusUI();
    }

    // 4. Final UI updates
    window.openPreview(); 
    updateButtonStates(); 
};

window.syncMediaStatusUI = () => {
    const infoEl = document.getElementById('media-info-display');
    if (!infoEl) return;

    // Source of truth: are there files selected?
    const count = currentMediaFiles.length;
    
    if (count > 0) {
        const fileTxt = count === 1 ? "file" : "files";
        infoEl.innerText = `✓ ${count} ${fileTxt} ready to post!`;
        infoEl.style.color = '#34C759'; // Success Green
    } else {
        infoEl.innerText = "Max 3 images and 1 video (15s limit).";
        infoEl.style.color = '#007AFF'; // Instruction Blue
    }
};

function initReorderLogic() {
    const container = document.getElementById('media-thumbnails');
    const confirmBtn = document.getElementById('confirm-reorder');
    let draggedItem = null;

    container.addEventListener('pointerdown', (e) => {
        draggedItem = e.target.closest('.thumb');
        if (!draggedItem) return;
        draggedItem.style.opacity = '0.5';
    });

    container.addEventListener('pointermove', (e) => {
        if (!draggedItem) return;
        e.preventDefault(); // Stop page scrolling
        
        const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.thumb');
        
        if (target && target !== draggedItem) {
            const rect = target.getBoundingClientRect();
            // Simple swap: if you drag over an element, move your item before/after it
            if (e.clientX < rect.left + rect.width / 2) {
                container.insertBefore(draggedItem, target);
            } else {
                container.insertBefore(draggedItem, target.nextSibling);
            }
            // Enable button as soon as a move occurs
            confirmBtn.disabled = false;
            confirmBtn.style.opacity = '1';
        }
    });

    container.addEventListener('pointerup', () => {
        if (!draggedItem) return;
        draggedItem.style.opacity = '1';
        draggedItem = null;
    });

        if (confirmBtn) {
        confirmBtn.onclick = () => {
            const container = document.getElementById('media-thumbnails');
            const thumbs = Array.from(container.querySelectorAll('.thumb'));
            
            // Sync the array to the NEW visual order
            currentMediaFiles = thumbs.map(thumb => {
                const originalIndex = parseInt(thumb.getAttribute('data-index'));
                return currentMediaFiles[originalIndex];
            });

            isReordered = true; // Crucial! This locks in the custom order
            window.openPreview(); // Refresh the whole preview to show the new gallery order
        };
    }
}

// Add this to your INTERACTION LISTENERS section
// Add a global variable to store the media status
let mediaError = null; // Changed from a string to null
const inputs = ['postDescription', 'postCategory', 'postSubcategory'];

document.getElementById('postImage').addEventListener('change', async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const submitBtn = document.getElementById('submitPost');
    const infoEl = document.getElementById('media-info-display');
    
    isReordered = false; 
    if (submitBtn) submitBtn.innerText = "Checking...";
    
    // 1. Get the validation object
    const validationResult = await getValidationErrors(); 
    
    if (infoEl) {
        if (validationResult && validationResult.type === 'media') {
            // --- ERROR STATE ---
            infoEl.innerText = validationResult.message;
            infoEl.style.color = '#ff4d4d'; 
            
            const fileInput = document.getElementById('postImage');
            if (fileInput) fileInput.value = ''; 
            const overlay = document.getElementById('media-lock-overlay');
            if (overlay) overlay.style.display = 'none';
        } else {
            // --- SUCCESS STATE ---
            const count = files.length;
            
            // IMPORTANT: If you use the preview system, you must populate 
            // currentMediaFiles BEFORE calling updateButtonStates
            currentMediaFiles = Array.from(files); 
            
            // This function now handles the green text and the "✓" message
            window.syncMediaStatusUI(); 
            
            // Lock the UI (hides the input, shows the lock icon)
            lockMediaInput(count);
        }
    }
    
    if (submitBtn) submitBtn.innerText = "Post Now";
    
    // Now when this runs, it sees currentMediaFiles.length > 0 and keeps it green
    updateButtonStates(); 
});

function lockMediaInput(count) {
    const overlay = document.getElementById('media-lock-overlay');
    const lockText = document.getElementById('lock-text');
    const fileInput = document.getElementById('postImage');

    if (overlay && lockText && fileInput) {
        // Ensure overlay covers the input area
        overlay.style.height = fileInput.offsetHeight + "px";
        
        // Update the count text
        lockText.innerText = `${count} file${count !== 1 ? 's' : ''} selected`;
        
        // Hide the "Choose Files" button visually but keep the space
        fileInput.style.opacity = '0'; 
        fileInput.style.pointerEvents = 'none'; 
        overlay.style.display = 'flex';
    }
}

window.clearMediaSelection = () => {
    const fileInput = document.getElementById('postImage');
    const overlay = document.getElementById('media-lock-overlay');
    const badge = document.getElementById('media-status-badge');

    // 1. Reset the actual File Input
    if (fileInput) {
        fileInput.value = ''; 
        fileInput.style.opacity = '1';
        fileInput.style.pointerEvents = 'auto';
    }

    // 2. Hide overlays
    if (overlay) overlay.style.display = 'none';
    if (badge) badge.style.display = 'none';

    // 3. Memory Cleanup
    if (currentMediaFiles.length > 0) {
        currentMediaFiles.forEach(file => {
            if (file._previewUrl) URL.revokeObjectURL(file._previewUrl);
        });
    }

    // 4. Reset global states
    currentMediaFiles = [];
    isReordered = false;
    
    // Set validation state (this will be an object based on your earlier setup)
    mediaError = { type: 'media', message: "Please add at least one image or video." };

    // --- THE COLOR FIX ---
    const infoEl = document.getElementById('media-info-display');
    if (infoEl) {
        infoEl.innerText = "Max 3 images and 1 video (15s limit).";
        infoEl.style.color = '#007AFF'; // Change from Red to Neutral Blue
    }
    
    updateButtonStates();
};

// 2. Light lifting: Runs as you type
inputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
        el.addEventListener(id === 'postDescription' ? 'input' : 'change', updateButtonStates);
    }
});
async function updateButtonStates() {
    const nextBtn = document.getElementById('modalNextBtn');
    const submitBtn = document.getElementById('submitPost');
    const previewBtn = document.getElementById('previewBtn');
    const scheduleError = document.getElementById('schedule-error-display');
    window.syncMediaStatusUI(); 

    const error = await getValidationErrors();
    
    // --- STEP 1: Always Active ---
    if (currentStep === 1) {
        if (nextBtn) {
            nextBtn.disabled = false;
            nextBtn.style.opacity = "1";
            nextBtn.style.pointerEvents = "auto";
        }
        return; 
    }

    // 2. Collect basic field states
    const description = document.getElementById('postDescription')?.value.trim() || "";
    const fileInput = document.getElementById('postImage');
    const hasFiles = isReordered ? currentMediaFiles.length > 0 : (fileInput && fileInput.files && fileInput.files.length > 0);
    
    // Description is required; title is optional
    const isDescOk = description.length > 0;
    const isCategoryOk = document.getElementById('postCategory').value !== "";

    // --- STEP 2: The "Next" Button Gate ---
    if (currentStep === 2 && nextBtn) {
        // IMPORTANT: On Step 2, we ONLY care if Media and Text are okay.
        // We IGNORE 'schedule' errors here so the button stays active.
        const hasMediaOrTextError = error && (error.type === 'media' || error.type === 'text');
        const canGoToStep3 = isDescOk && hasFiles && !hasMediaOrTextError;

        nextBtn.disabled = !canGoToStep3;
        nextBtn.style.opacity = canGoToStep3 ? "1" : "0.5";
        nextBtn.style.pointerEvents = canGoToStep3 ? "auto" : "none";
    }

    // --- STEP 3: The "Post Now" Gate ---
    if (currentStep === 3) {
        // On Step 3, we care about EVERYTHING, including schedule errors.
        const isFullyValid = (error === null) && isCategoryOk;

        // Handle the error text visibility
        if (scheduleError) {
            if (error && error.type === 'schedule') {
                scheduleError.innerText = error.message;
                scheduleError.style.display = 'block';
            } else {
                scheduleError.style.display = 'none';
            }
        }

        if (submitBtn) {
            submitBtn.disabled = !isFullyValid;
            submitBtn.style.opacity = isFullyValid ? "1" : "0.5";
        }
        if (previewBtn) {
            previewBtn.disabled = !isFullyValid;
            previewBtn.style.opacity = isFullyValid ? "1" : "0.5";
        }
    }
}
// Add the new IDs to your watch list
const inputsToWatch = [
    'postDescription', 
    'postCategory', 
    'postSubcategory', 
    'postImage',
    'startDate',    // NEW: Date input
    'startTime',    // NEW: Time input
    'isFuturePost'  // NEW: The hidden checkbox toggled by setPostMode
];

inputsToWatch.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
        // Use 'input' for the text area for real-time feedback, 
        // and 'change' for everything else (selects, files, dates)
        const eventType = (id === 'postDescription') ? 'input' : 'change';
        
        el.addEventListener(eventType, async () => {
            await updateButtonStates();
        });
    }
});

// Run once on load
updateButtonStates();

window.toggleMapHeight = function() {
    const header = document.querySelector('header');
    const MAX_HEIGHT = 450;
    
    // If it's currently small, we want to open it. If it's big, close it.
    const isCurrentlyCollapsed = header.offsetHeight < 100; 
    const targetHeight = isCurrentlyCollapsed ? MAX_HEIGHT : 0;
    
    header.style.transition = "height 0.5s cubic-bezier(0.19, 1, 0.22, 1)";
    header.style.height = `${targetHeight}px`;
    
    setTimeout(() => {
        if (typeof map !== 'undefined') map.invalidateSize();
    }, 500);
};

// --- RESIZE LOGIC ---
const header = document.querySelector('header');
const handle = document.getElementById('drag-handle');
let isResizing = false;
let startY = 0;
let initialHeight = 0;
let hasMovedEnough = false;
const DRAG_THRESHOLD = 8; 

const setTransition = (enable) => {
    header.style.transition = enable ? "height 0.4s cubic-bezier(0.19, 1, 0.22, 1)" : "none";
};

handle.addEventListener('mousedown', (e) => {
    startTracking(e.clientY);
});

handle.addEventListener('touchstart', (e) => {
    // Only track the touch, don't preventDefault here or buttons inside might break
    startTracking(e.touches[0].clientY);
}, { passive: true });

function startTracking(clientY) {
    isResizing = true;
    startY = clientY;
    initialHeight = header.offsetHeight;
    hasMovedEnough = false;
    setTransition(false); 
}

const handleMove = (clientY, e) => {
    if (!isResizing) return;
    
    const deltaY = clientY - startY;
    
    if (!hasMovedEnough && Math.abs(deltaY) > DRAG_THRESHOLD) {
        hasMovedEnough = true;
    }

    if (hasMovedEnough) {
        updateLayout(initialHeight + deltaY);
        if (e && e.cancelable) e.preventDefault(); 
    }
};

document.addEventListener('mousemove', (e) => handleMove(e.clientY));
document.addEventListener('touchmove', (e) => handleMove(e.touches[0].clientY, e), { passive: false });

const stopResizing = (e) => { 
    if (!isResizing) return;
    
    isResizing = false; 
    setTransition(true);

    if (!hasMovedEnough) {
        // --- THE FIX ---
        // Prevent the browser from sending a second 'click' event
        if (e.cancelable) e.preventDefault();
        
        if (typeof toggleMapHeight === 'function') {
            toggleMapHeight();
        }
    } else {
        // Snap logic: if dragged near the top, just close it
        if (header.offsetHeight < 40) updateLayout(0);
    }
    
    hasMovedEnough = false;
};

document.addEventListener('mouseup', stopResizing);
document.addEventListener('touchend', stopResizing, { passive: false });

function updateLayout(targetHeight) {
    const MIN_HEIGHT = 0;
    const MAX_HEIGHT = 450;
    
    let newHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, targetHeight));
    header.style.height = `${newHeight}px`;

    if (typeof map !== 'undefined') {
        map.invalidateSize({ animate: false });
    }
}
window.scrollGallery = (btn, direction) => {
    const wrapper = btn.closest('.post-card-image-wrapper'); // More robust than parentElement
    const gallery = wrapper.querySelector('.image-gallery');
    const scrollAmount = gallery.offsetWidth;
    
    gallery.scrollBy({
        left: direction * scrollAmount,
        behavior: 'smooth'
    });

    // Check visibility after the smooth scroll finishes
    setTimeout(() => {
        updateArrowVisibility(gallery);
    }, 350); 
};
window.updateArrowVisibility = (gallery) => {
    const wrapper = gallery.closest('.post-card-image-wrapper');
    if (!wrapper) return;

    const leftArrow = wrapper.querySelector('.nav-arrow.left');
    const rightArrow = wrapper.querySelector('.nav-arrow.right');
    const dots = wrapper.querySelectorAll('.gallery-dot');
    
    const scrollLeft = gallery.scrollLeft;
    const clientWidth = gallery.clientWidth;
    const maxScroll = gallery.scrollWidth - clientWidth;

    // 1. Calculate current index (same logic as the dots)
    const currentIndex = Math.round(scrollLeft / clientWidth);

    // 2. Toggle Arrow Fading
    if (leftArrow) {
        // Only hide if we are firmly on the first slide (index 0)
        // This ensures the arrow stays visible until you've swiped halfway to slide 2
        leftArrow.classList.toggle('hidden', currentIndex === 0 && scrollLeft < (clientWidth / 2));
    }

    if (rightArrow) {
        // Only hide if we are firmly on the last slide
        const totalSlides = Math.round(gallery.scrollWidth / clientWidth);
        const isLastSlide = currentIndex === (totalSlides - 1);
        
        rightArrow.classList.toggle('hidden', isLastSlide && scrollLeft > (maxScroll - (clientWidth / 2)));
    }
    
    // 3. Toggle Dot Active State
    if (dots.length > 0) {
        dots.forEach((dot, i) => {
            dot.classList.toggle('active', i === currentIndex);
        });
    }
};

window.openDirections = (lat, lng) => {
    // This is the standard universal link that works on mobile and desktop
    const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    window.open(url, '_blank');
};
window.toggleLike = async (postId) => {
    // 1. Check active Firebase Auth state directly
    const user = auth.currentUser;
    if (!user) {
        alert("Authentication initializing. Please try again in a moment.");
        return;
    }

    const userId = user.uid;

    if (window.isLiking === postId) return;
    window.isLiking = postId;
    
    const countEl = document.getElementById(`like-count-${postId}`);
    const btn = document.querySelector(`button[onclick="toggleLike('${postId}')"]`);
    const svg = btn?.querySelector('svg');

    if (!countEl || !svg) {
        window.isLiking = null;
        return;
    }

    // 2. Determine current state locally
    const isLiked = svg.getAttribute('fill') !== 'none' && svg.getAttribute('fill') !== '';
    let currentCount = parseInt(countEl.innerText) || 0;
    let newCount = isLiked ? Math.max(0, currentCount - 1) : currentCount + 1;

    // 3. IMMEDIATE OPTIMISTIC UI UPDATE
    countEl.innerText = newCount;
    countEl.style.display = newCount > 0 ? 'inline' : 'none';

    if (isLiked) {
        // Switch to UNLIKED
        svg.setAttribute('fill', 'none');
        svg.style.color = "#433838"; 
    } else {
        // Switch to LIKED
        svg.setAttribute('fill', '#d22f6d');
        svg.style.color = "#d22f6d";
    }

    // Update in-memory post cache immediately
    const localPost = allPosts.find(p => p.id === postId);
    if (localPost) {
        if (!localPost.likedBy) localPost.likedBy = {};
        if (isLiked) {
            delete localPost.likedBy[userId];
        } else {
            localPost.likedBy[userId] = true;
        }
        localPost.likes = newCount;
    }

    // 4. BACKGROUND DATABASE SYNC
    try {
        const statusRef = ref(db, `pulses/${postId}/likedBy/${userId}`);
        const postRef = ref(db, `pulses/${postId}`);

        if (isLiked) {
            await set(statusRef, null);
            await update(postRef, { likes: increment(-1) });
        } else {
            await set(statusRef, true);
            await update(postRef, { likes: increment(1) });
        }
    } catch (err) {
        console.error("Like sync failed:", err);
        
        // 5. REVERT UI & CACHE ON FAILURE
        countEl.innerText = currentCount;
        countEl.style.display = currentCount > 0 ? 'inline' : 'none';
        
        if (isLiked) {
            svg.setAttribute('fill', '#d22f6d');
            svg.style.color = "#d22f6d";
        } else {
            svg.setAttribute('fill', 'none');
            svg.style.color = "#433838";
        }

        if (localPost) {
            if (isLiked) {
                localPost.likedBy[userId] = true;
            } else {
                delete localPost.likedBy[userId];
            }
            localPost.likes = currentCount;
        }
    } finally {
        window.isLiking = null; // Always release lock
    }
};
document.getElementById('postCategory').addEventListener('change', (e) => {
    const subSelect = document.getElementById('postSubcategory');
    const selectedCategory = e.target.value;
    const subcategories = categoryMap[selectedCategory] || ["General"];

    // 1. Unlock the dropdown
    subSelect.disabled = false;

    // 2. Clear and fill the new options
    subSelect.innerHTML = subcategories.map(sub => 
        `<option value="${sub}">${sub}</option>`
    ).join('');
    
    // 3. Ensure "General" is the default
    subSelect.value = "General";
});

async function getVideoDuration(file) {
    return new Promise((resolve) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.onloadedmetadata = () => {
            window.URL.revokeObjectURL(video.src);
            resolve(video.duration);
        };
        video.src = URL.createObjectURL(file);
    });
}

async function getValidationErrors() {
    // 1. Always use the processed array (currentMediaFiles)
    // if it's empty, we check the raw input as a fallback
    const files = currentMediaFiles.length > 0 
        ? currentMediaFiles 
        : Array.from(document.getElementById('postImage').files);
        
    const description = document.getElementById('postDescription').value.trim();

    const LIMITS = {
        maxChars: 280,
        maxImages: 3,
        maxVideos: 1,
        maxSize: 20 * 1024 * 1024, 
        maxDuration: 15 
    };

    // 1. MEDIA CHECKS (Type: media)
    if (files.length === 0) return { type: 'media', message: "Please add at least one image or video." };
    
    let imageCount = 0;
    let videoCount = 0;

    for (let file of files) {
        if (file.size > LIMITS.maxSize) {
            return { type: 'media', message: `File "${file.name}" is too large (Max 20MB).` };
        }
        if (file.type.startsWith('image/')) imageCount++;
        else if (file.type.startsWith('video/')) {
            videoCount++;
            const duration = await getVideoDuration(file);
            if (duration > LIMITS.maxDuration) {
                return { type: 'media', message: `Video too long (Max ${LIMITS.maxDuration}s).` };
            }
        }
    }

    if (imageCount > LIMITS.maxImages) return { type: 'media', message: `Too many images! Max is ${LIMITS.maxImages}.` };
    if (videoCount > LIMITS.maxVideos) return { type: 'media', message: `Only ${LIMITS.maxVideos} video allowed.` };

    // 2. TEXT CHECKS (Type: text)
    if (description.length === 0) {
        return { type: 'text', message: "What's happening? Please add a description." };
    }
    if (description.length > LIMITS.maxChars) {
        return { type: 'text', message: `Your post is too long! Max is ${LIMITS.maxChars} characters.` };
    }

    // 3. SCHEDULE CHECKS (Type: schedule)
    const isFuture = document.getElementById('isFuturePost').checked;
        if (isFuture) {
            const dateVal = document.getElementById('startDate').value;
            const timeVal = document.getElementById('startTime').value;
            
            if (!dateVal || !timeVal) return { type: 'schedule', message: "Please set both a date and time." };

            const selectedDate = new Date(`${dateVal}T${timeVal}`);
            const now = new Date();

            // --- 1 HOUR MINIMUM CHECK ---
            const oneHourFromNow = new Date(now.getTime() + 3600000); 
            if (selectedDate < oneHourFromNow) {
                return { type: 'schedule', message: "Future events must start at least 1 hour from now." };
            }

            // --- 10 DAY MAXIMUM CHECK (Inclusive of full day) ---
            const maxFutureDate = new Date(now);
            maxFutureDate.setDate(now.getDate() + 10);
            // Reset to 23:59:59.999 so the entire 10th day is valid
            maxFutureDate.setHours(23, 59, 59, 999);

            if (selectedDate > maxFutureDate) {
                return { 
                    type: 'schedule', 
                    message: "Events can only be scheduled up to 10 days in advance." 
                };
            }
        }

    return null;
}

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return Math.round(R * c);
}

setInterval(() => {
    const now = Date.now();
    const timers = document.querySelectorAll('.pulse-timer');
    const progressTracks = document.querySelectorAll('.post-progress-track');

    // --- 1. LIVE PROGRESS BAR UPDATES ---
    progressTracks.forEach(track => {
        const startTime = parseInt(track.dataset.start);
        const lifespanMs = parseInt(track.dataset.lifespan);
        const fill = track.querySelector('.post-progress-fill');
        
        if (!fill || !startTime || !lifespanMs) return;

        const isPending = startTime > now;

        if (isPending) {
            // Still scheduled -> Full orange bar
            fill.style.width = '100%';
            fill.style.backgroundColor = '#c07227';
        } else {
            // Post is live -> Calculate active percentage remaining
            const elapsedTime = now - startTime;
            const remainingTime = lifespanMs - elapsedTime;
            let remainingPercentage = (remainingTime / lifespanMs) * 100;

            if (remainingPercentage < 0) remainingPercentage = 0;
            if (remainingPercentage > 100) remainingPercentage = 100;

            fill.style.width = `${remainingPercentage.toFixed(2)}%`;
            fill.style.backgroundColor = '#2d8b6d';
        }
    });

    // --- 2. LIVE COUNTDOWN TIMER UPDATES ---
    timers.forEach(timer => {
        const startTime = parseInt(timer.dataset.start);
        const endTime = parseInt(timer.dataset.expiry);
        
        const postCard = timer.closest('.post-card');
        const wrapper = postCard ? postCard.querySelector('.badge-wrapper') : null;
        const timerContainer = timer.parentElement; 
        
        // --- CASE: POST IS NOW LIVE ---
        if (now >= startTime && now < endTime) {
            const timeRemainingMs = endTime - now;
            const minsRemaining = Math.max(0, Math.floor(timeRemainingMs / 60000));
            const totalHoursRemaining = Math.floor(minsRemaining / 60);

            let timeVal;
            if (minsRemaining >= 2160) {
                timeVal = `${Math.round(minsRemaining / 1440)}d`;
            } else if (minsRemaining >= 1080) {
                timeVal = `1d`;
            } else if (totalHoursRemaining >= 1) {
                const mins = minsRemaining % 60;
                timeVal = mins > 0 ? `${totalHoursRemaining}h ${mins}m` : `${totalHoursRemaining}h`;
            } else {
                timeVal = `${minsRemaining}m`;
            }

            // Replace text prefix with inline SVG icon
            const newHtml = `Live: ${timeVal} left`;

            if (timer.innerHTML !== newHtml) {
                timer.innerHTML = newHtml;
            }

            // Keep LIVE badge standard green
            if (wrapper) {
                wrapper.style.backgroundColor = 'rgb(19 40 30 / 0.75)';
                wrapper.style.color = '#69dbb6';
                wrapper.style.borderColor = 'rgba(64, 192, 87, 0.3)';
            }

            // Turn urgent red when under 30 mins
            if (timerContainer) {
                if (minsRemaining < 30) {
                    timerContainer.style.color = '#ca2727';
                } else {
                    timerContainer.style.color = 'inherit';
                }
            }
        }
    });
}, 60000);

window.sharePost = async (postId) => {
    // You can customize the message or URL per post
    const postData = {
        title: 'Check out this post!',
        text: 'Found something interesting on Pulse app:',
        url: window.location.href + '#post-' + postId // Links directly to the post
    };

    if (navigator.share) {
        try {
            await navigator.share(postData);
        } catch (err) {
            console.error('Sharing failed:', err);
        }
    } else {
        // Fallback for desktop: Copy to clipboard
        navigator.clipboard.writeText(postData.url);
        alert('Link copied to clipboard!');
    }
};

document.addEventListener('DOMContentLoaded', () => {
    // This triggers the 'locationfound' logic above automatically
    map.locate({ setView: true, maxZoom: 14, enableHighAccuracy: true });
});

document.addEventListener('DOMContentLoaded', () => {
    const overlay = document.getElementById('onboarding-overlay');
    const slides = document.getElementById('onboarding-slides');
    const dots = document.querySelectorAll('.onboarding-dot');

    // 1. CHECK IF USER HAS SEEN IT
    const hasSeenOnboarding = localStorage.getItem('pulse_onboarding_complete');

    if (!hasSeenOnboarding) {
        overlay.style.display = 'flex';
    }

    // 2. UPDATE DOTS ON SCROLL
    slides.addEventListener('scroll', () => {
        const index = Math.round(slides.scrollLeft / slides.offsetWidth);
        dots.forEach((dot, i) => {
            dot.classList.toggle('active', i === index);
        });
    });
});
window.completeOnboarding = function() {
    const overlay = document.getElementById('onboarding-overlay');
    if (!overlay) return;

    // Add a nice fade-out effect
    overlay.style.transition = 'opacity 0.5s ease';
    overlay.style.opacity = '0';
    
    setTimeout(() => {
        overlay.style.display = 'none';
        localStorage.setItem('pulse_onboarding_complete', 'true');
    }, 500);
};

// FOR TESTING: Run this in console to show it again
// localStorage.removeItem('pulse_onboarding_complete');

document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', function() {
        // Scroll the clicked button into the center of the scroll area
        this.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest',
            inline: 'center'
        });
    });
});

window.syncAppView = function() {
    // 1. Update the Feed (Sidebar)
    updateFeed(getVisiblePosts());
    
    // 2. Update the Map (Markers)
    refreshMapMarkers(allPosts);
    
    // 3. Optional: Reset button visibility check (kept safe with optional chaining)
    const resetBtn = document.getElementById('reset-filters');
    if (resetBtn) {
        const isDefault = activeStatusFilters.Live && activeStatusFilters.Scheduled;
        resetBtn.style.display = isDefault ? 'none' : 'flex';
    }
};
// Toggle Reaction Popover Visibility
window.toggleReactionMenu = function(postId) {
    const popover = document.getElementById(`reaction-popover-${postId}`);
    if (!popover) return;
    
    // Close all other open popovers first
    document.querySelectorAll('.reaction-popover').forEach(el => {
        if (el.id !== `reaction-popover-${postId}`) el.style.display = 'none';
    });

    const isHidden = popover.style.display === 'none' || !popover.style.display;
    popover.style.display = isHidden ? 'flex' : 'none';
};
// Handle Reaction Selection / Un-selection with Firebase Sync
window.submitReaction = async function(postId, reactionType) {
    // 1. Get active Firebase user
    const user = auth.currentUser;
    if (!user) {
        alert("Authentication initializing. Please try again in a moment.");
        return;
    }
    const userId = user.uid;

    const targetPost = allPosts.find(p => p.id === postId);
    if (!targetPost) return;

    // Ensure state structures exist
    if (!targetPost.reactions) {
        targetPost.reactions = { interested: 0, countMeIn: 0, goodTip: 0 };
    }
    if (!targetPost.userReactions) {
        targetPost.userReactions = {};
    }

    // Close the popover immediately for clean UX
    const popover = document.getElementById(`reaction-popover-${postId}`);
    if (popover) popover.style.display = 'none';

    // Store previous states for fallback/revert
    const previousReaction = targetPost.userReactions[userId] || null;
    const isTogglingOff = previousReaction === reactionType;
    const newReaction = isTogglingOff ? null : reactionType;

    // Prepare atomic update map for Firebase
    const dbUpdates = {};
    const userReactionRefPath = `pulses/${postId}/userReactions/${userId}`;

    // 2. OPTIMISTIC IN-MEMORY & DATABASE PREPARATION
    if (isTogglingOff) {
        // Removing reaction
        targetPost.reactions[reactionType] = Math.max(0, (targetPost.reactions[reactionType] || 1) - 1);
        delete targetPost.userReactions[userId];
        targetPost.userReaction = null;

        dbUpdates[userReactionRefPath] = null;
        dbUpdates[`pulses/${postId}/reactions/${reactionType}`] = increment(-1);
    } else {
        // Switching or adding reaction
        if (previousReaction) {
            // Decrement old choice
            targetPost.reactions[previousReaction] = Math.max(0, (targetPost.reactions[previousReaction] || 1) - 1);
            dbUpdates[`pulses/${postId}/reactions/${previousReaction}`] = increment(-1);
        }
        // Increment new choice
        targetPost.reactions[reactionType] = (targetPost.reactions[reactionType] || 0) + 1;
        targetPost.userReactions[userId] = reactionType;
        targetPost.userReaction = reactionType;

        dbUpdates[userReactionRefPath] = reactionType;
        dbUpdates[`pulses/${postId}/reactions/${reactionType}`] = increment(1);
    }

    // Immediate UI Re-render
    if (typeof syncAppView === 'function') {
        syncAppView();
    } else if (typeof window.handleSortChange === 'function') {
        window.handleSortChange();
    }

    // 3. BACKGROUND FIREBASE SYNC
    try {
        await update(ref(db), dbUpdates);
    } catch (err) {
        console.error("Reaction sync failed:", err);
        
        // 4. REVERT STATE ON FAILURE
        if (previousReaction) {
            targetPost.userReactions[userId] = previousReaction;
            targetPost.userReaction = previousReaction;
        } else {
            delete targetPost.userReactions[userId];
            targetPost.userReaction = null;
        }

        // Re-render feed to reflect reverted state
        if (typeof syncAppView === 'function') syncAppView();
    }
};

// Close popovers on click outside
document.addEventListener('click', function(e) {
    if (!e.target.closest('.reaction-container')) {
        document.querySelectorAll('.reaction-popover').forEach(el => el.style.display = 'none');
    }
});
function updateProfileNavButton(user) {
    const statusDot = document.getElementById('profileStatusDot');
    if (!statusDot) return;

    statusDot.style.display = 'block';
    if (user.isAnonymous) {
        // Purple dot signals Guest mode / Upgrade available
        statusDot.style.backgroundColor = '#a855f7'; 
    } else {
        // Green dot signals active Permanent account
        statusDot.style.backgroundColor = '#22c55e'; 
    }
}
window.openProfileModal = function() {
    const user = auth.currentUser;
    if (!user) return;

    const isAnon = user.isAnonymous;
    const existingCustomUsername = localStorage.getItem(`pulse_username_${user.uid}`);
    const isUsernameLocked = isAnon || !!existingCustomUsername; 
    const currentHandle = existingCustomUsername || (typeof getPulseHandle === 'function' ? getPulseHandle(user.uid) : 'Guest');
    const currentAvatar = localStorage.getItem(`pulse_avatar_${user.uid}`) || '';

    const modalHtml = `
        <div style="padding: 24px 20px 20px 20px; text-align: center; font-family: -apple-system, BlinkMacSystemFont, sans-serif;">
            
            <!-- AVATAR PREVIEW -->
            <div style="position: relative; width: 76px; height: 76px; margin: 0 auto 14px auto;">
                <div id="modalAvatarPreview" style="
                    width: 100%; 
                    height: 100%; 
                    border-radius: 50%; 
                    background: ${currentAvatar ? `url('${currentAvatar}') center/cover` : (isAnon ? '#f3e8ff' : '#f0fdf4')}; 
                    color: ${isAnon ? '#9333ea' : '#16a34a'};
                    display: flex; 
                    align-items: center; 
                    justify-content: center; 
                    font-size: 28px;
                    border: 2px solid #e2e8f0;
                    overflow: hidden;
                    box-shadow: 0 4px 10px rgba(0,0,0,0.1);
                ">
                    ${!currentAvatar ? (isAnon ? '👤' : '✨') : ''}
                </div>
                
                ${isAnon ? `
                    <div onclick="alert('Please create or log into an account to customize your profile picture!')" style="
                        position: absolute; bottom: 0; right: 0; background: #94a3b8; color: #fff;
                        width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center;
                        justify-content: center; cursor: pointer; border: 2px solid #ffffff;
                    " title="Log in to change avatar">🔒</div>
                ` : `
                    <label for="avatarFileInput" style="
                        position: absolute; bottom: 0; right: 0; background: #3b82f6; color: #fff;
                        width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center;
                        justify-content: center; cursor: pointer; border: 2px solid #ffffff;
                    " title="Upload avatar">📷</label>
                `}
            </div>

            ${!isAnon ? `<input type="file" id="avatarFileInput" accept="image/*" style="display: none;" onchange="previewSelectedAvatar(event)">` : ''}

            <!-- ACCOUNT STATUS BADGE -->
            <div style="margin-bottom: 12px;">
                <span style="
                    font-size: 10px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase;
                    padding: 3px 8px; border-radius: 12px; 
                    background: ${isAnon ? '#fef3c7' : '#dcfce7'}; 
                    color: ${isAnon ? '#d97706' : '#15803d'};
                ">
                    ${isAnon ? 'Guest Profile' : 'Verified Account'}
                </span>
            </div>

            <!-- EMAIL VERIFICATION STATUS BAR (PERMANENT USERS ONLY) -->
            ${!isAnon ? `
                <div style="
                    margin-bottom: 16px; 
                    padding: 8px 12px; 
                    border-radius: 10px; 
                    font-size: 12px; 
                    display: flex; 
                    align-items: center; 
                    justify-content: space-between;
                    background: ${user.emailVerified ? '#f0fdf4' : '#fffbeb'}; 
                    border: 1px solid ${user.emailVerified ? '#bbf7d0' : '#fde68a'};
                    color: ${user.emailVerified ? '#166534' : '#92400e'};
                ">
                    <span>${user.emailVerified ? '✅ Email Verified' : '⚠️ Unverified Email'}</span>
                    ${!user.emailVerified ? `
                        <button onclick="resendVerificationEmail()" style="
                            background: #f59e0b; color: #ffffff; border: none; padding: 4px 8px; 
                            border-radius: 6px; font-weight: 600; font-size: 11px; cursor: pointer;
                        ">Resend Email</button>
                    ` : ''}
                </div>
            ` : ''}

            <!-- PROFILE FORM FIELD -->
            <div style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 18px; text-align: left;">
                <div>
                    <label style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">
                        Username ${isUsernameLocked ? '🔒' : ''}
                    </label>
                    <input type="text" id="editUsernameInput" value="${currentHandle}" 
                        ${isUsernameLocked ? 'disabled' : ''} 
                        placeholder="Enter username..." style="
                            width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 10px; 
                            font-size: 14px; margin-top: 4px; box-sizing: border-box;
                            background: ${isUsernameLocked ? '#f1f5f9' : '#ffffff'};
                            color: ${isUsernameLocked ? '#64748b' : '#0f172a'};
                    ">
                </div>
            </div>

            <!-- ACTION BUTTONS FOR GUESTS vs PERMANENT USERS -->
            ${isAnon ? `
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    <button onclick="showAuthModal('signup')" style="
                        width: 100%; background: #3b82f6; color: #ffffff; border: none; 
                        padding: 11px; border-radius: 10px; font-weight: 600; font-size: 14px; 
                        cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;
                    ">
                        Create Account (Email)
                    </button>

                    <button onclick="showAuthModal('login')" style="
                        width: 100%; background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; 
                        padding: 11px; border-radius: 10px; font-weight: 600; font-size: 14px; 
                        cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;
                    ">
                        Log In
                    </button>

                    <!-- TEMPORARY GOOGLE OPTION -->
                    <button onclick="convertAccountWithGoogle()" style="
                        width: 100%; background: #ffffff; color: #334155; border: 1px solid #cbd5e1; 
                        padding: 11px; border-radius: 10px; font-weight: 600; font-size: 14px; 
                        cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;
                    ">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12.545,10.239v3.821h5.445c-0.712,2.315-2.647,3.972-5.445,3.972c-3.332,0-6.033-2.701-6.033-6.032s2.701-6.032,6.033-6.032c1.498,0,2.866,0.549,3.921,1.453l2.814-2.814C17.503,2.988,15.139,2,12.545,2C6.721,2,2,6.721,2,12.545s4.721,10.545,10.545,10.545c6.539,0,10.655-4.6,10.655-10.841c0-0.732-0.078-1.442-0.218-2.124H12.545z"/></svg>
                        Continue with Google
                    </button>
                </div>
            ` : `
                <button id="saveProfileBtn" onclick="saveUserProfileSettings()" style="
                    width: 100%; background: #3b82f6; color: #ffffff; border: none; 
                    padding: 11px; border-radius: 10px; font-weight: 600; font-size: 14px; 
                    cursor: pointer; margin-bottom: 8px;
                ">
                    Save Changes
                </button>

                <button onclick="logoutUser()" style="
                    width: 100%; background: #f1f5f9; color: #ef4444; border: 1px solid #fee2e2; 
                    padding: 11px;margin-bottom: 8px;border-radius: 10px; font-weight: 600; font-size: 14px; cursor: pointer;
                ">
                    Log Out
                </button>

                <button onclick="deleteUserAccount()" style="
                    width: 100%; background: #530000; color: #ef4444; border: 1px solid #ae0a0a; 
                    padding: 11px;margin-bottom: 8px;border-radius: 10px; font-weight: 600; font-size: 14px; cursor: pointer;
                ">
                    Delete Account
                </button>
            `}

        </div>
    `;

    showCustomModal(modalHtml);
};

// --- DEDICATED AUTHENTICATION MODAL ---
window.showAuthModal = function(initialTab = 'signup') {
    const isSignup = initialTab === 'signup';

    const authHtml = `
        <div style="padding: 24px 20px 20px 20px; text-align: left; font-family: -apple-system, BlinkMacSystemFont, sans-serif;">
            
            <!-- TAB TOGGLE -->
            <div style="display: flex; background: #f1f5f9; padding: 4px; border-radius: 10px; margin-bottom: 18px;">
                <button id="tabSignupBtn" onclick="showAuthModal('signup')" style="
                    flex: 1; padding: 8px; border: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;
                    background: ${isSignup ? '#ffffff' : 'transparent'};
                    color: ${isSignup ? '#0f172a' : '#64748b'};
                    box-shadow: ${isSignup ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'};
                ">Create Account</button>
                <button id="tabLoginBtn" onclick="showAuthModal('login')" style="
                    flex: 1; padding: 8px; border: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;
                    background: ${!isSignup ? '#ffffff' : 'transparent'};
                    color: ${!isSignup ? '#0f172a' : '#64748b'};
                    box-shadow: ${!isSignup ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'};
                ">Log In</button>
            </div>

            ${isSignup ? `
                <!-- CREATE ACCOUNT FORM -->
                <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px;">
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Username</label>
                        <input type="text" id="regUsername" placeholder="e.g. alex_99" style="width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px; box-sizing: border-box; margin-top: 3px;">
                    </div>
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Email Address</label>
                        <input type="email" id="regEmail" placeholder="name@example.com" style="width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px; box-sizing: border-box; margin-top: 3px;">
                    </div>
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Confirm Email Address</label>
                        <input type="email" id="regEmailConfirm" placeholder="Re-enter email address" style="width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px; box-sizing: border-box; margin-top: 3px;">
                    </div>
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Password</label>
                        <input type="password" id="regPassword" placeholder="Minimum 6 characters" style="width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px; box-sizing: border-box; margin-top: 3px;">
                    </div>
                </div>

                <button id="submitAuthBtn" onclick="processAccountCreation()" style="
                    width: 100%; background: #3b82f6; color: #ffffff; border: none; 
                    padding: 12px; border-radius: 10px; font-weight: 600; font-size: 14px; cursor: pointer;
                ">
                    Create Account
                </button>
            ` : `
                <!-- LOG IN FORM -->
                <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px;">
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Email Address</label>
                        <input type="email" id="loginEmail" placeholder="name@example.com" style="width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px; box-sizing: border-box; margin-top: 3px;">
                    </div>
                    <div>
                        <label style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Password</label>
                        <input type="password" id="loginPassword" placeholder="••••••••" style="width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px; box-sizing: border-box; margin-top: 3px;">
                    </div>
                </div>

                <button id="submitAuthBtn" onclick="processUserLogin()" style="
                    width: 100%; background: #0f172a; color: #ffffff; border: none; 
                    padding: 12px; border-radius: 10px; font-weight: 600; font-size: 14px; cursor: pointer;
                ">
                    Log In
                </button>
            `}
        </div>
    `;

    showCustomModal(authHtml);
};

// --- PROCESS ACCOUNT CREATION & VERIFICATION ---
window.processAccountCreation = async function() {
    const username = document.getElementById('regUsername')?.value.trim();
    const email = document.getElementById('regEmail')?.value.trim();
    const emailConfirm = document.getElementById('regEmailConfirm')?.value.trim();
    const password = document.getElementById('regPassword')?.value;
    const btn = document.getElementById('submitAuthBtn');

    // 1. FORM VALIDATION
    if (!username || !email || !emailConfirm || !password) {
        alert("Please fill in all fields.");
        return;
    }

    const validUsernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
    if (!validUsernameRegex.test(username)) {
        alert("Username must be 3–20 characters long and contain only letters, numbers, or underscores.");
        return;
    }

    if (email.toLowerCase() !== emailConfirm.toLowerCase()) {
        alert("Email addresses do not match. Please double check!");
        return;
    }

    if (password.length < 6) {
        alert("Password must be at least 6 characters long.");
        return;
    }

    try {
        if (btn) { btn.disabled = true; btn.innerText = "Creating Account..."; }

        // 2. CHECK USERNAME AVAILABILITY IN REALTIME DATABASE
        const cleanHandle = username.toLowerCase();
        const usernameRef = ref(db, `usernames/${cleanHandle}`);
        const snapshot = await get(usernameRef);

        if (snapshot.exists()) {
            alert(`The username "${username}" is already taken. Please pick another one.`);
            if (btn) { btn.disabled = false; btn.innerText = "Create Account"; }
            return;
        }

        // 3. CREATE OR LINK FIREBASE USER
        const credential = EmailAuthProvider.credential(email, password);
        let user;

        if (auth.currentUser && auth.currentUser.isAnonymous) {
            const linkResult = await linkWithCredential(auth.currentUser, credential);
            user = linkResult.user;
        } else {
            const createResult = await createUserWithEmailAndPassword(auth, email, password);
            user = createResult.user;
        }

        // 4. SAVE USERNAME TO REALTIME DATABASE
        const updates = {};
        updates[`usernames/${cleanHandle}`] = user.uid;
        updates[`users/${user.uid}/username`] = username;
        updates[`users/${user.uid}/usernameKey`] = cleanHandle;
        updates[`users/${user.uid}/updatedAt`] = Date.now();

        await update(ref(db), updates);

        localStorage.setItem(`pulse_username_${user.uid}`, username);

        // 5. SEND VERIFICATION EMAIL
        await sendEmailVerification(user);

        alert(`Account created! A verification link has been sent to ${email}. You can verify now or anytime from your profile.`);

        document.getElementById('custom-app-modal')?.remove();
        updateProfileNavButton(user);
        if (typeof window.handleSortChange === 'function') window.handleSortChange();

    } catch (error) {
        console.error("Registration error:", error);
        if (error.code === 'auth/email-already-in-use') {
            alert("This email is already registered. Please click 'Log In' instead.");
        } else {
            alert("Account creation failed: " + error.message);
        }
        if (btn) { btn.disabled = false; btn.innerText = "Create Account"; }
    }
};

// --- PROCESS USER LOGIN ---
window.processUserLogin = async function() {
    const email = document.getElementById('loginEmail')?.value.trim();
    const password = document.getElementById('loginPassword')?.value;
    const btn = document.getElementById('submitAuthBtn');

    if (!email || !password) {
        alert("Please enter both email and password.");
        return;
    }

    try {
        if (btn) { btn.disabled = true; btn.innerText = "Logging In..."; }

        const result = await signInWithEmailAndPassword(auth, email, password);
        await syncUserProfileData(result.user);

        document.getElementById('custom-app-modal')?.remove();
        updateProfileNavButton(result.user);
        if (typeof window.handleSortChange === 'function') window.handleSortChange();

        alert("Welcome back!");
    } catch (error) {
        console.error("Login error:", error);
        alert("Invalid email or password.");
        if (btn) { btn.disabled = false; btn.innerText = "Log In"; }
    }
};


// Logic to process Email Registration or Log In
window.handleEmailAuth = async function(mode) {
    const email = document.getElementById('authEmailInput')?.value.trim();
    const password = document.getElementById('authPasswordInput')?.value;

    if (!email || !password) {
        alert("Please enter both an email address and password.");
        return;
    }

    if (password.length < 6) {
        alert("Password must be at least 6 characters long.");
        return;
    }

    try {
        if (mode === 'register') {
            const credential = EmailAuthProvider.credential(email, password);
            if (auth.currentUser && auth.currentUser.isAnonymous) {
                // Link existing guest session to Email credentials
                const result = await linkWithCredential(auth.currentUser, credential);
                console.log("✅ Guest linked to Email:", result.user.uid);
                await handlePostAccountSetup(result.user);
            } else {
                const result = await createUserWithEmailAndPassword(auth, email, password);
                await handlePostAccountSetup(result.user);
            }
        } else {
            // Log into an existing Email account
            const result = await signInWithEmailAndPassword(auth, email, password);
            console.log("✅ Logged in with Email:", result.user.uid);
            await syncUserProfileData(result.user);
            document.getElementById('custom-app-modal')?.remove();
            updateProfileNavButton(result.user);
            if (typeof window.handleSortChange === 'function') window.handleSortChange();
            alert("Logged in successfully!");
        }
    } catch (error) {
        console.error("Email auth error:", error);
        if (error.code === 'auth/email-already-in-use' || error.code === 'auth/credential-already-in-use') {
            alert("This email is already registered. Please tap 'Log In' instead.");
        } else if (error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
            alert("Invalid email or password.");
        } else {
            alert("Auth failed: " + error.message);
        }
    }
};

// Helper: Instant preview for selected avatar file
window.previewSelectedAvatar = function(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const preview = document.getElementById('modalAvatarPreview');
            if (preview) {
                preview.style.background = `url('${e.target.result}') center/cover`;
                preview.innerHTML = ''; // Clear fallback emoji
            }
        };
        reader.readAsDataURL(file);
    }
};
window.saveUserProfileSettings = async function() {
    const user = auth.currentUser;
    if (!user) return;

    // BLOCK GUEST USERS FROM SAVING PROFILE CHANGES
    if (user.isAnonymous) {
        alert("Guest accounts cannot customize profiles. Please save your account with Google first!");
        return;
    }

    const usernameInput = document.getElementById('editUsernameInput').value.trim();
    const fileInput = document.getElementById('avatarFileInput');
    const saveBtn = document.getElementById('saveProfileBtn');
    
    const existingCustomUsername = localStorage.getItem(`pulse_username_${user.uid}`);
    const isCreatingNewUsername = !existingCustomUsername;

    // Check if user is attempting to modify a locked username
    if (existingCustomUsername && usernameInput.toLowerCase() !== existingCustomUsername.toLowerCase()) {
        alert("Usernames are permanent and cannot be changed.");
        return;
    }

    if (!usernameInput) {
        alert("Username cannot be empty.");
        return;
    }

    const validUsernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
    if (isCreatingNewUsername && !validUsernameRegex.test(usernameInput)) {
        alert("Username must be 3–20 characters long and contain only letters, numbers, or underscores.");
        return;
    }

    const cleanHandle = usernameInput.toLowerCase();

    try {
        // UI Feedback: Disable button during processing & upload
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerText = "Saving...";
        }

        // 1. Check Username Uniqueness if setting a custom username for the first time
        if (isCreatingNewUsername) {
            const usernameRef = ref(db, `usernames/${cleanHandle}`);
            const snapshot = await get(usernameRef);

            if (snapshot.exists() && snapshot.val() !== user.uid) {
                alert(`The username "${usernameInput}" is already taken. Please choose another one.`);
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.innerText = "Save Changes";
                }
                return;
            }
        }

        // 2. Upload Avatar Image to Firebase Storage (if a new file was selected)
        let finalAvatarUrl = localStorage.getItem(`pulse_avatar_${user.uid}`) || '';
        
        if (fileInput && fileInput.files.length > 0) {
            const file = fileInput.files[0];
            const fileExtension = file.name.split('.').pop();
            const storagePath = sRef(storage, `profile_pictures/${user.uid}.${fileExtension}`);
            
            const uploadSnapshot = await uploadBytes(storagePath, file);
            finalAvatarUrl = await getDownloadURL(uploadSnapshot.ref);
        }

        // 3. Prepare Atomic Multi-Path Database Updates
        const updates = {};
        
        if (isCreatingNewUsername) {
            updates[`usernames/${cleanHandle}`] = user.uid;
            updates[`users/${user.uid}/username`] = usernameInput;
            updates[`users/${user.uid}/usernameKey`] = cleanHandle;
        }
        
        updates[`users/${user.uid}/avatarUrl`] = finalAvatarUrl;
        updates[`users/${user.uid}/updatedAt`] = Date.now();

        // 4. Perform Firebase Update
        await update(ref(db), updates);

        // 5. Update Local Storage Cache
        if (isCreatingNewUsername) {
            localStorage.setItem(`pulse_username_${user.uid}`, usernameInput);
        }
        localStorage.setItem(`pulse_avatar_${user.uid}`, finalAvatarUrl);

        alert("Profile updated successfully!");

        // Close Modal & update profile button status
        document.getElementById('custom-app-modal')?.remove();
        updateProfileNavButton(user);

    } catch (error) {
        console.error("Error saving profile:", error);
        alert("Failed to save profile: " + error.message);
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerText = "Save Changes";
        }
    }
};

// Generic Custom Modal Overlay Generator
window.showCustomModal = function(htmlContent) {
    // Remove existing modal if open
    const existingModal = document.getElementById('custom-app-modal');
    if (existingModal) existingModal.remove();

    // Create backdrop wrapper
    const modalContainer = document.createElement('div');
    modalContainer.id = 'custom-app-modal';
    modalContainer.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
    `;

    // Create inner content box
    const modalBox = document.createElement('div');
    modalBox.style.cssText = `
        background: #ffffff;
        border-radius: 16px;
        max-width: 320px;
        width: 100%;
        overflow: hidden;
        box-shadow: 0 20px 25px -5px rgba(0,0,0,0.3);
        position: relative;
    `;

    // Add Close Button
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '✕';
    closeBtn.style.cssText = `
        position: absolute;
        top: 10px;
        right: 12px;
        background: none;
        border: none;
        font-size: 16px;
        color: #94a3b8;
        cursor: pointer;
    `;
    closeBtn.onclick = () => modalContainer.remove();

    modalBox.appendChild(closeBtn);

    // Inject inner body
    const contentWrapper = document.createElement('div');
    contentWrapper.innerHTML = htmlContent;
    modalBox.appendChild(contentWrapper);

    modalContainer.appendChild(modalBox);
    document.body.appendChild(modalContainer);

    // Dismiss when clicking outside modal box
    modalContainer.addEventListener('click', (e) => {
        if (e.target === modalContainer) modalContainer.remove();
    });
};

// --- LOGOUT USER FUNCTION ---
window.logoutUser = async function() {
    const confirmLogout = confirm("Are you sure you want to log out?");
    if (!confirmLogout) return;

    try {
        const currentUid = auth.currentUser ? auth.currentUser.uid : null;

        // Clear local storage profile cache for this user
        if (currentUid) {
            localStorage.removeItem(`pulse_username_${currentUid}`);
            localStorage.removeItem(`pulse_avatar_${currentUid}`);
        }
        localStorage.removeItem('pulse_user_id');

        // Sign out from Firebase Auth
        await signOut(auth);

        // Close profile modal
        document.getElementById('custom-app-modal')?.remove();
        alert("Logged out successfully! You are now browsing as a guest.");

        // Note: onAuthStateChanged will fire automatically and create a new anonymous guest session.

    } catch (error) {
        console.error("Logout error:", error);
        alert("Failed to log out: " + error.message);
    }
};

// Sync user profile from Firebase into local cache on login
async function syncUserProfileData(user) {
    if (!user || user.isAnonymous) return;

    try {
        const userRef = ref(db, `users/${user.uid}`);
        const snapshot = await get(userRef);

        if (snapshot.exists()) {
            const userData = snapshot.val();
            
            // Sync Username
            if (userData.username) {
                localStorage.setItem(`pulse_username_${user.uid}`, userData.username);
            }
            
            // Sync Avatar URL
            if (userData.avatarUrl) {
                localStorage.setItem(`pulse_avatar_${user.uid}`, userData.avatarUrl);
            }
            
            console.log("✅ Profile synced from database:", userData);
        }
    } catch (error) {
        console.error("Error syncing profile data:", error);
    }
}

// --- DELETE ACCOUNT & CLEANUP PII (OPTION B: PERMANENT HANDLE LOCKING) ---
window.deleteUserAccount = async function() {
    const user = auth.currentUser;
    if (!user || user.isAnonymous) return;

    const confirmFirst = confirm(
        "⚠️ Are you sure you want to delete your account?\n\n" +
        "This will permanently delete your login credentials, profile picture, and profile settings.\n" +
        "Your handle will remain locked to prevent impersonation, and existing posts will remain active until they expire."
    );
    if (!confirmFirst) return;

    const confirmSecond = prompt("To confirm deletion, type DELETE below:");
    if (confirmSecond !== "DELETE") {
        alert("Account deletion canceled.");
        return;
    }

    try {
        const uid = user.uid;
        const existingAvatar = localStorage.getItem(`pulse_avatar_${uid}`);
        const existingUsername = localStorage.getItem(`pulse_username_${uid}`);

        // 1. Delete Profile Avatar from Firebase Storage if it exists
        if (existingAvatar && existingAvatar.includes('firebasestorage')) {
            try {
                const storagePath = sRef(storage, `profile_pictures/${uid}`);
                await deleteObject(storagePath);
            } catch (storageErr) {
                console.warn("Storage deletion error (ignored):", storageErr);
            }
        }

        // 2. Wipe User Profile Record from Realtime Database
        // (NOTE: We deliberately leave `/usernames/${handle}` intact so the handle is permanently reserved)
        const updates = {};
        updates[`users/${uid}`] = null;
        await update(ref(db), updates);

        // 3. Clear Local Storage Keys
        if (existingUsername) localStorage.removeItem(`pulse_username_${uid}`);
        if (existingAvatar) localStorage.removeItem(`pulse_avatar_${uid}`);
        localStorage.removeItem('pulse_user_id');

        // 4. Delete Auth User from Firebase Authentication
        await deleteUser(user);

        // 5. Close Modal and Notify User
        document.getElementById('custom-app-modal')?.remove();
        alert("Your account has been permanently deleted.");

        // Firebase's onAuthStateChanged will fire automatically to sign in a fresh Anonymous guest session

    } catch (error) {
        console.error("Delete account error:", error);

        // Sensitive auth operations (like user deletion) require a fresh login if the session is old
        if (error.code === 'auth/requires-recent-login') {
            alert("Security Notice: Deleting your account requires a recent login. Please log out, log back in, and try deleting your account again.");
        } else {
            alert("Failed to delete account: " + error.message);
        }
    }
};

// Toggle Author Profile Popover
window.toggleAuthorPopover = function(event, postId) {
    event.stopPropagation();
    
    // Close any other open author popovers first
    document.querySelectorAll('.author-popover').forEach(pop => {
        if (pop.id !== `author-popover-${postId}`) {
            pop.style.display = 'none';
        }
    });

    const popover = document.getElementById(`author-popover-${postId}`);
    if (popover) {
        const isHidden = popover.style.display === 'none' || !popover.style.display;
        popover.style.display = isHidden ? 'block' : 'none';
    }
};

// Global listener to close popover when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.author-popover') && !e.target.closest('.author-pill-btn')) {
        document.querySelectorAll('.author-popover').forEach(pop => pop.style.display = 'none');
    }
});
window.filterFeedByUser = function(authorId, authorUsername) {
    // 1. Close all open popovers
    document.querySelectorAll('.author-popover').forEach(pop => pop.style.display = 'none');

    // 2. Filter all master posts by this specific author
    allFilteredPosts = allPosts.filter(p => 
        (authorId && p.authorId === authorId) || 
        (authorUsername && p.authorUsername === authorUsername)
    );

    // 3. SHOW ACTIVE FILTER BANNER
    // Pass username if available, fallback to authorId
    const displayName = authorUsername || authorId || 'user';
    if (typeof setActiveFilterBanner === 'function') {
        setActiveFilterBanner('user', displayName);
    }

    // 4. Reset feed slice index & clear current DOM container
    currentSliceIndex = 0;
    const feed = document.getElementById('feed');
    if (feed) feed.innerHTML = '';

    // 5. Render the filtered slice
    if (typeof renderNextSlice === 'function') {
        renderNextSlice();
    }

    // Scroll back to top of feed smoothly
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

function formatHashtags(text) {
    if (!text) return '';
    
    // Only matches #hashtags preceded by start-of-string or whitespace, 
    // and followed by end-of-string, whitespace, or punctuation.
    const hashtagRegex = /(?<=^|\s)#[a-zA-Z0-9_\u00C0-\u024F]+(?=$|\s|[.,!?:;])/g;
    
    return text.replace(hashtagRegex, (match) => {
        const tag = match.trim().substring(1); // Remove the '#'
        return `<span onclick="filterFeedByHashtag('${tag}')" class="hashtags" style="
            cursor: pointer; 
            transition: color 0.15s ease;
        " onmouseover="this.style.color='#1d4ed8'" onmouseout="this.style.color='#2563eb'">${match}</span>`;
    });
}

window.filterFeedByHashtag = function(tag) {
    const cleanTag = tag.startsWith('#') ? tag.substring(1) : tag;

    // Filter posts that contain the hashtag in their description
    allFilteredPosts = allPosts.filter(p => {
        return p.description && p.description.toLowerCase().includes(`#${cleanTag.toLowerCase()}`);
    });

    // Update floating filter banner
    setActiveFilterBanner('hashtag', `#${cleanTag}`);

    // Reset slice index & clear DOM feed container
    currentSliceIndex = 0;
    const feed = document.getElementById('feed');
    if (feed) feed.innerHTML = '';

    // Re-render feed slice
    if (typeof renderNextSlice === 'function') {
        renderNextSlice();
    }

    // Scroll smoothly to top of feed
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.appendTagToDescription = function(tag) {
    const textarea = document.getElementById('postDescription');
    if (!textarea) return;

    let currentText = textarea.value;

    // Format spacing
    if (currentText.length > 0 && !/\s$/.test(currentText)) {
        currentText += ' ';
    }
    const newText = currentText + tag;

    if (newText.length > 280) return;

    textarea.value = newText;

    // Trigger input event to handle sync & duplicate detection
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
};
window.renderPopularTags = function() {
    const container = document.getElementById('suggestedTagsContainer');
    if (!container) return;

    // 1. Calculate tag frequencies across all active posts
    const tagCounts = {};

    if (Array.isArray(allPosts)) {
        allPosts.forEach(post => {
            // Check saved hashtags array or fallback to parsing the description
            let tags = post.hashtags;
            if (!tags && post.description) {
                const matches = post.description.match(/(?<=^|\s)#[a-zA-Z0-9_\u00C0-\u024F]+(?=$|\s|[.,!?:;])/g);
                tags = matches ? matches.map(t => t.trim().substring(1).toLowerCase()) : [];
            }

            if (Array.isArray(tags)) {
                tags.forEach(tag => {
                    const cleanTag = tag.replace('#', '').toLowerCase().trim();
                    if (cleanTag) {
                        tagCounts[cleanTag] = (tagCounts[cleanTag] || 0) + 1;
                    }
                });
            }
        });
    }

    // 2. Sort tags by frequency
    const sortedTags = Object.keys(tagCounts)
        .sort((a, b) => tagCounts[b] - tagCounts[a])
        .map(tag => `#${tag}`);

    // 3. Take top 3, or fill remaining slots with defaults
    const fallbackDefaults = ['#recommend', '#freebie', '#meetup'];
    const top3 = [];

    // Add most frequent unique tags first
    for (const tag of sortedTags) {
        if (top3.length < 3 && !top3.includes(tag)) {
            top3.push(tag);
        }
    }

    // Fill remaining slots with defaults if needed
    for (const defaultTag of fallbackDefaults) {
        if (top3.length < 3 && !top3.includes(defaultTag)) {
            top3.push(defaultTag);
        }
    }

    // 4. Render the buttons with data-tag attributes
    container.innerHTML = top3.map(tag => `
        <button type="button" data-tag="${tag}" onclick="appendTagToDescription('${tag}')" style="
            background: rgba(37, 99, 235, 0.15);
            border: 1px solid rgba(37, 99, 235, 0.3);
            color: #3b82f6;
            font-size: 11px;
            font-weight: 600;
            padding: 2px 8px;
            border-radius: 12px;
            cursor: pointer;
            transition: all 0.15s ease;
        ">${tag}</button>
    `).join('');

    // 5. Sync button states against current text in description
    const postDescription = document.getElementById('postDescription');
    if (postDescription && typeof syncSuggestedTagButtons === 'function') {
        syncSuggestedTagButtons(postDescription.value);
    }
};

// State variables for active user and hashtag filters
let currentActiveFilter = {
    type: null,  // 'user' or 'hashtag'
    value: null  // username or tag name
};

// Function to set and show the filter banner
window.setActiveFilterBanner = function(type, value) {
    currentActiveFilter = { type, value };

    const banner = document.getElementById('activeFilterBanner');
    const targetText = document.getElementById('activeFilterTarget');

    if (!banner || !targetText) return;

    if (type === 'user') {
        targetText.textContent = `@${value.replace(/^@/, '')}`;
    } else if (type === 'hashtag') {
        const cleanTag = value.startsWith('#') ? value : `#${value}`;
        targetText.textContent = cleanTag;
    }

    banner.style.display = 'flex';
};

// Function to clear active user/hashtag filters
window.clearActiveFilter = function() {
    currentActiveFilter = { type: null, value: null };

    const banner = document.getElementById('activeFilterBanner');
    if (banner) banner.style.display = 'none';

    // Reset filtered posts to show all posts from getVisiblePosts()
    const posts = getVisiblePosts();
    allFilteredPosts = (posts === "TOO_FAR") ? [] : posts;

    // Reset slice index and re-render feed
    currentSliceIndex = 0;
    const feed = document.getElementById('feed');
    if (feed) feed.innerHTML = '';

    if (typeof renderNextSlice === 'function') {
        renderNextSlice();
    }
};

let osloSearchDebounce = null;

function setupOsloVenueSearch() {
    const input = document.getElementById('oslo-venue-search');
    const results = document.getElementById('oslo-venue-results');

    if (!input || !results) return;

    input.value = '';
    results.style.display = 'none';

    // Fetch matching venues on input
    input.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        clearTimeout(osloSearchDebounce);

        if (query.length < 2) {
            results.style.display = 'none';
            results.innerHTML = '';
            return;
        }

        // Debounce 300ms to reduce API calls
        osloSearchDebounce = setTimeout(() => {
            fetchOsloVenuesFromApi(query, results);
        }, 300);
    });

    // Close dropdown when clicking outside map container
    document.addEventListener('click', (e) => {
        const mapContainer = document.getElementById('mini-map-container');
        if (mapContainer && !mapContainer.contains(e.target)) {
            results.style.display = 'none';
        }
    });
}

// FETCH LIVE VENUES & BUSINESSES IN OSLO USING PHOTON AUTOCOMPLETE API
async function fetchOsloVenuesFromApi(query, resultsContainer) {
    try {
        // Oslo center focus (lat: 59.9139, lon: 10.7522)
        const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&lat=59.9139&lon=10.7522&zoom=12&limit=6&lang=en`;

        const response = await fetch(url);

        if (!response.ok) {
            renderOsloApiResults([], resultsContainer);
            return;
        }

        const data = await response.json();

        // Photon returns GeoJSON features format: { features: [ { properties, geometry } ] }
        if (!data || !data.features) {
            renderOsloApiResults([], resultsContainer);
            return;
        }

        // Filter results strictly inside Oslo / Akershus area
        const osloResults = data.features
            .filter(f => f.properties.city === 'Oslo' || f.properties.state === 'Oslo' || f.properties.country === 'Norway')
            .map(f => ({
                lat: f.geometry.coordinates[1],
                lon: f.geometry.coordinates[0],
                namedetails: { name: f.properties.name },
                display_name: `${f.properties.name || ''}, ${f.properties.street || f.properties.district || ''} ${f.properties.housenumber || ''}, Oslo`.trim()
            }));

        renderOsloApiResults(osloResults, resultsContainer);
    } catch (err) {
        console.error('Error fetching Oslo business list:', err);
        renderOsloApiResults([], resultsContainer);
    }
}

function renderOsloApiResults(data, resultsContainer) {
    // FIX: Verify data is an actual Array before calling .map()
    if (!Array.isArray(data) || data.length === 0) {
        resultsContainer.innerHTML = `<div style="padding: 8px 10px; font-size: 11px; color: #94a3b8;">No Oslo venues found</div>`;
        resultsContainer.style.display = 'block';
        return;
    }

    resultsContainer.innerHTML = data.map((item) => {
        const title = item.namedetails?.name || item.display_name.split(',')[0];
        const subtitle = item.display_name.split(',').slice(1, 3).join(',').trim();
        
        // Escape single/double quotes safely
        const safeTitle = (title || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
        const safeAddress = (item.display_name || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');

        return `
            <div onclick="snapToApiVenue(${item.lat}, ${item.lon}, '${safeTitle}', '${safeAddress}')" 
                 style="
                    padding: 7px 10px;
                    border-bottom: 1px solid #f1f5f9;
                    cursor: pointer;
                    text-align: left;
                 "
                 onmouseover="this.style.background='#f8fafc'"
                 onmouseout="this.style.background='#ffffff'"
            >
                <div style="font-size: 11.5px; font-weight: 700; color: #0f172a;">${title}</div>
                <div style="font-size: 10px; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${subtitle}</div>
            </div>
        `;
    }).join('');

    resultsContainer.style.display = 'block';
}
// SNAP MAP TO SELECTED AUTO-POPULATED VENUE
window.snapToApiVenue = function(lat, lng, name, fullAddress) {
    const targetLat = parseFloat(lat);
    const targetLng = parseFloat(lng);

    const results = document.getElementById('oslo-venue-results');
    const input = document.getElementById('oslo-venue-search');

    if (results) results.style.display = 'none';
    if (input) input.value = name;

    // Check distance restrictions against allowed posting radius
    if (window.userLatLng && window.userLatLng.lat) {
        const dist = getDistance(window.userLatLng.lat, window.userLatLng.lng, targetLat, targetLng);
        if (typeof MAX_DISTANCE !== 'undefined' && dist > MAX_DISTANCE) {
            alert(`"${name}" is outside your current allowed posting radius.`);
            return;
        }
    }

    // Move miniMap & pin directly to the venue coordinates
    if (miniMap && miniMarker) {
        isProgrammaticMove = true; 

        miniMap.panTo([targetLat, targetLng], { animate: true });
        miniMarker.setLatLng([targetLat, targetLng]);

        postLatLng = { lat: targetLat, lng: targetLng };

        // Update address display
        const addressEl = document.getElementById('address-display');
        if (addressEl) {
            addressEl.innerText = `${name}, ${fullAddress.split(',')[0]}`;
        } else if (typeof updateAddressDisplay === 'function') {
            updateAddressDisplay(targetLat, targetLng);
        }

        setTimeout(() => { isProgrammaticMove = false; }, 350);
    }
};

// --- BOTTOM SHEET DETAILS POPUP HANDLERS ---
window.openPostDetailsSheet = function(postId) {
    // 1. Check if bottom sheet element exists, or create it dynamically
    let sheet = document.getElementById('post-details-bottom-sheet');
    let overlay = document.getElementById('post-details-overlay');

    if (!sheet) {
        // Overlay background
        overlay = document.createElement('div');
        overlay.id = 'post-details-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0, 0, 0, 0.4);
            backdrop-filter: blur(4px);
            z-index: 9998;
            opacity: 0;
            transition: opacity 0.25s ease;
        `;
        overlay.onclick = closePostDetailsSheet;
        document.body.appendChild(overlay);

        // Bottom Sheet modal
        sheet = document.createElement('div');
        sheet.id = 'post-details-bottom-sheet';
        sheet.style.cssText = `
            position: fixed;
            bottom: 0; left: 0; right: 0;
            z-index: 19999;
            background: #ffffff;
            border-top-left-radius: 16px;
            border-top-right-radius: 16px;
            padding: 20px 16px;
            box-shadow: 0 -4px 20px rgba(0,0,0,0.15);
            transform: translateY(100%);
            transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            max-height: 80vh;
            overflow-y: auto;
        `;
        document.body.appendChild(sheet);
    }

    // 2. Fetch the post info content from the template
    const template = document.getElementById(`post-info-data-${postId}`);
    const infoContent = template ? template.innerHTML : '<p style="color:#64748b; font-size:13px;">No additional details available.</p>';

    // 3. Populate sheet with handle drag bar and details content
    sheet.innerHTML = `
        <div style="width: 36px; height: 4px; background: #cbd5e1; border-radius: 2px; margin: 0 auto 16px auto;"></div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <h4 style="margin: 0; font-size: 15px; font-weight: 700; color: #0f172a;">Post Details</h4>
            <button onclick="closePostDetailsSheet()" style="background: none; border: none; font-size: 18px; color: #64748b; cursor: pointer; padding: 0;">✕</button>
        </div>
        <div class="sheet-details-body" style="font-size: 13px; color: #334155; line-height: 1.5;">
            ${infoContent}
        </div>
    `;

    // 4. Slide up transition
    overlay.style.display = 'block';
    setTimeout(() => {
        overlay.style.opacity = '1';
        sheet.style.transform = 'translateY(0)';
    }, 10);
};

window.closePostDetailsSheet = function() {
    const sheet = document.getElementById('post-details-bottom-sheet');
    const overlay = document.getElementById('post-details-overlay');
    if (!sheet || !overlay) return;

    sheet.style.transform = 'translateY(100%)';
    overlay.style.opacity = '0';

    setTimeout(() => {
        overlay.style.display = 'none';
    }, 250);
};
