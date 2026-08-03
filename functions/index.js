const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");

// Initialize the app so the Janitor has permission to delete things
if (!admin.apps.length) {
    admin.initializeApp();
}

exports.cleanupExpiredPulses = onSchedule('every 1 minutes', async (event) => {
    const db = admin.database();
    const bucket = admin.storage().bucket();
    const now = Date.now();
    const pulsesRef = db.ref('pulses');

    const snapshot = await pulsesRef.once('value');
    const data = snapshot.val();

    if (!data) return null;

    const updates = {};
    const mediaPathsToDelete = [];

    Object.keys(data).forEach(id => {
        const post = data[id];

        // 1. SHIELD LOGIC: If it's a future post that hasn't started yet, SKIP IT.
        // This prevents the Janitor from deleting a post based on its 'createdAt' 
        // time before it even goes live.
        if (post.scheduledStartTime && now < post.scheduledStartTime) {
            // console.log(`Janitor: Skipping future pulse ${id} - not yet live.`);
            return; 
        }

        // 2. SAFE START TIME
        // Now that we know it's not a "future" post, we determine when its life began.
        const rawStart = post.scheduledStartTime || post.createdAt || now;
        
        // Safety check for Firebase serverTimestamp objects
        const startTime = (typeof rawStart === 'object') ? now : rawStart;

        // 3. EXPIRATION MATH
        const lifespanMs = (Number(post.lifespanHours) || 3) * 60 * 60 * 1000;
        const expirationTime = startTime + lifespanMs;

        // 4. THE EXECUTIONER
        if (now > expirationTime) {
            console.log(`Janitor: Pulse ${id} expired at ${new Date(expirationTime).toISOString()}. Cleaning up...`);
            updates[id] = null;

            if (post.mediaItems && Array.isArray(post.mediaItems)) {
                post.mediaItems.forEach(item => {
                    if (item.path) mediaPathsToDelete.push(item.path);
                });
            }
        }
    });

    const expiredCount = Object.keys(updates).length;

    if (expiredCount > 0) {
        // Multi-path update is atomic - all deletions happen or none do
        await pulsesRef.update(updates);
        
        const storageDeletions = mediaPathsToDelete.map(path => 
            bucket.file(path).delete().catch(err => 
                console.warn(`Storage delete skipped for ${path}:`, err.message)
            )
        );

        await Promise.all(storageDeletions);
        console.log(`Janitor finished: Removed ${expiredCount} pulses.`);
    } else {
        console.log("Janitor: No pulses expired in this cycle.");
    }

    return null;
});

const { onValueDeleted } = require("firebase-functions/v2/database");
const { getStorage } = require("firebase-admin/storage");

// INSTANT CLEANUP: Triggered when a user manually deletes a pulse
exports.onPulseDeleted = onValueDeleted("/pulses/{pulseId}", async (event) => {
    const deletedData = event.data.val();
    
    // Safety check: if there's no media, we're done
    if (!deletedData || !deletedData.mediaItems || !Array.isArray(deletedData.mediaItems)) {
        return null;
    }

    const bucket = getStorage().bucket();
    const media = deletedData.mediaItems;

    console.log(`Cleanup: Pulse ${event.params.pulseId} deleted. Cleaning ${media.length} files...`);

    const deletePromises = media.map(item => {
        // Use the path property first, fallback to parsing if necessary
        const path = item.path || (item.url ? decodeURIComponent(item.url.split('/o/')[1].split('?')[0]) : null);
        
        if (path) {
            return bucket.file(path).delete().catch(err => {
                // Ignore if file was already deleted by another process
                if (err.code === 404) return null;
                console.error(`Failed to delete storage item: ${path}`, err.message);
            });
        }
        return null;
    });

    await Promise.all(deletePromises);
    return null;
});

// This runs once every 24 hours (at midnight)
exports.storageTimeBomb = onSchedule('0 0 * * *', async (event) => {
    const bucket = getStorage().bucket();
    
    // IMPORTANT: Only look inside the 'media' folder
    const [files] = await bucket.getFiles({ prefix: 'media/' });
    
    const now = Date.now();
    const MAX_AGE_MS = 11 * 24 * 60 * 60 * 1000;
    
    let deletedCount = 0;

    const deletePromises = files.map(async (file) => {
        // Skip the folder placeholder itself if it exists
        if (file.name === 'media/') return null;

        const [metadata] = await file.getMetadata();
        const createdTime = new Date(metadata.timeCreated).getTime();

        if (now - createdTime > MAX_AGE_MS) {
            console.log(`Time-Bomb: Purging expired media: ${file.name}`);
            deletedCount++;
            return file.delete().catch(err => {
                if (err.code !== 404) console.error(`Delete failed: ${file.name}`, err.message);
            });
        }
        return null;
    });

    await Promise.all(deletePromises);
    console.log(`Time-Bomb finished: Removed ${deletedCount} files from /media.`);
});