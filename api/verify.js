const admin = require('firebase-admin');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        }),
        databaseURL: "https://ai-perfect-tools-default-rtdb.asia-southeast1.firebasedatabase.app"
    });
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
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

        // Get token
        const tokenRef = admin.database().ref(`tokens/${token}`);
        const snapshot = await tokenRef.once('value');

        if (!snapshot.exists()) {
            return res.status(200).json({ 
                success: false, 
                message: 'Invalid link' 
            });
        }

        const data = snapshot.val();

        // Validate
        if (data.used) {
            return res.status(200).json({ 
                success: false, 
                message: 'Already used' 
            });
        }

        if (data.userId !== userId) {
            return res.status(200).json({ 
                success: false, 
                message: 'Invalid user' 
            });
        }

        if (Date.now() > data.expiresAt) {
            return res.status(200).json({ 
                success: false, 
                message: 'Link expired' 
            });
        }

        // Mark as used
        await tokenRef.update({ 
            used: true, 
            usedAt: Date.now() 
        });

        // Add 24 hours
        const userRef = admin.database().ref(`users/${userId}`);
        const userSnap = await userRef.once('value');
        const userData = userSnap.val();

        if (!userData) {
            return res.status(200).json({ 
                success: false, 
                message: 'User not found' 
            });
        }

        const newExpiry = Date.now() + (24 * 60 * 60 * 1000);
        
        await userRef.update({
            accessExpiry: newExpiry,
            accessCount: (userData.accessCount || 0) + 1,
            lastAccessUnlock: Date.now()
        });

        return res.status(200).json({ 
            success: true, 
            message: '24 hours access added!',
            newExpiry: newExpiry
        });

    } catch (error) {
        console.error('Verify Error:', error);
        return res.status(500).json({ 
            success: false,
            message: 'Verification failed'
        });
    }
};
