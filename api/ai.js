const admin = require('firebase-admin');

// Initialize Firebase Admin (singleton pattern for Vercel)
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
    // CORS
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
        // Verify token
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const idToken = authHeader.split('Bearer ')[1];
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const uid = decodedToken.uid;

        // Check user access
        const userRef = admin.database().ref(`users/${uid}`);
        const userSnap = await userRef.once('value');
        const userData = userSnap.val();

        if (!userData) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (Date.now() >= userData.accessExpiry) {
            return res.status(403).json({ error: 'Access expired' });
        }

        // Get request data
        const { messages, maxTokens = 500 } = req.body;

        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ error: 'Messages required' });
        }

        // Call Perplexity AI
        const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;

        if (!PERPLEXITY_API_KEY) {
            return res.status(500).json({ error: 'API key missing' });
        }

        // Use node-fetch for Vercel compatibility
        const fetch = (await import('node-fetch')).default;

        const aiResponse = await fetch('https://api.perplexity.ai/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'sonar',
                messages: messages,
                max_tokens: maxTokens,
                temperature: 0.7
            })
        });

        if (!aiResponse.ok) {
            const errorText = await aiResponse.text();
            console.error('Perplexity error:', errorText);
            return res.status(500).json({ error: 'AI service error' });
        }

        const data = await aiResponse.json();

        // Update stats
        await userRef.update({
            toolsUsed: (userData.toolsUsed || 0) + 1,
            lastUsed: Date.now()
        });

        return res.status(200).json({
            success: true,
            response: data.choices[0].message.content
        });

    } catch (error) {
        console.error('AI API Error:', error);
        return res.status(500).json({ 
            error: 'Server error',
            message: error.message 
        });
    }
};
