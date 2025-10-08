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
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const idToken = authHeader.split('Bearer ')[1];
        const decodedToken = await admin.auth().verifyIdToken(idToken);

        const { url, userId } = req.body;

        if (!url || !userId) {
            return res.status(400).json({ error: 'Missing parameters' });
        }

        if (decodedToken.uid !== userId) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const fetch = (await import('node-fetch')).default;

        // VPLink API
        const VPLINK_API_KEY = '23a35248e9fd9c07cba6ea618b508f726f518080';
        const apiUrl = `https://vplink.in/api?api=${VPLINK_API_KEY}&url=${encodeURIComponent(url)}&format=text`;

        const response = await fetch(apiUrl);

        if (!response.ok) {
            throw new Error('VPLink API error');
        }

        const shortUrl = await response.text();

        if (!shortUrl || shortUrl.includes('error')) {
            throw new Error('Failed to generate shortlink');
        }

        return res.status(200).json({
            success: true,
            shortUrl: shortUrl.trim()
        });

    } catch (error) {
        console.error('Shortlink Error:', error);
        return res.status(500).json({ 
            error: 'Shortlink failed',
            message: error.message 
        });
    }
};
