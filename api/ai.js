const admin = require('firebase-admin');

// Initialize Firebase Admin
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
    // CORS headers
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
        // Verify Firebase token
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const idToken = authHeader.split('Bearer ')[1];
        let decodedToken;
        
        try {
            decodedToken = await admin.auth().verifyIdToken(idToken);
        } catch (error) {
            console.error('Token verification error:', error);
            return res.status(401).json({ error: 'Invalid token' });
        }

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
            return res.status(400).json({ error: 'Messages array required' });
        }

        // Call Perplexity AI
        const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;

        if (!PERPLEXITY_API_KEY) {
            console.error('Perplexity API key not found');
            return res.status(500).json({ error: 'API key not configured' });
        }

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
            console.error('Perplexity API error:', errorText);
            return res.status(500).json({ 
                error: 'AI service error',
                details: errorText 
            });
        }

        const data = await aiResponse.json();

        // Update user stats
        await userRef.update({
            toolsUsed: (userData.toolsUsed || 0) + 1,
            lastUsed: Date.now()
        });

        // Return AI response
        return res.status(200).json({
            success: true,
            response: data.choices[0].message.content
        });

    } catch (error) {
        console.error('AI API Error:', error);
        return res.status(500).json({ 
            error: 'Internal server error',
            message: error.message 
        });
    }
}
