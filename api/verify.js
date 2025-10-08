const admin = require('firebase-admin');

if (admin.apps.length === 0) {
    try {
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            }),
            databaseURL: "https://ai-perfect-tools-default-rtdb.asia-southeast1.firebasedatabase.app"
        });
    } catch (error) {
        console.error('Firebase init error:', error);
    }
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { userId, token } = req.body;

        if (!userId || !token) {
            return res.status(400).json({ 
                success: false, 
                message: 'Missing parameters' 
            });
        }

        // Get token data
        const tokenRef = admin.database().ref(`tokens/${token}`);
        const snapshot = await tokenRef.once('value');

        if (!snapshot.exists()) {
            return res.status(200).json({ 
                success: false, 
                message: 'Invalid or expired link' 
            });
        }

        const data = snapshot.val();

        // Validate token
        if (data.used) {
            return res.status(200).json({ 
                success: false, 
                message: 'This link has already been used' 
            });
        }

        if (data.userId !== userId) {
            return res.status(200).json({ 
                success: false, 
                message: 'Invalid user ID' 
            });
        }

        if (Date.now() > data.expiresAt) {
            return res.status(200).json({ 
                success: false, 
                message: 'Link expired (valid for 5 minutes only)' 
            });
        }

        // Mark token as used
        await tokenRef.update({ 
            used: true, 
            usedAt: Date.now() 
        });

        // Add 24 hours to user's access
        const userRef = admin.database().ref(`users/${userId}`);
        const userSnap = await userRef.once('value');
        const userData = userSnap.val();

        if (!userData) {
            return res.status(200).json({ 
                success: false, 
                message: 'User not found' 
            });
        }

        const newExpiry = Date.now() + (24 * 60 * 60 * 1000); // 24 hours
        
        await userRef.update({
            accessExpiry: newExpiry,
            accessCount: (userData.accessCount || 0) + 1,
            lastAccessUnlock: Date.now()
        });

        return res.status(200).json({ 
            success: true, 
            message: '24 hours unlimited access added successfully!',
            newExpiry: newExpiry
        });

    } catch (error) {
        console.error('Verify Error:', error);
        return res.status(500).json({ 
            success: false,
            message: 'Verification failed',
            error: error.message 
        });
    }
}
