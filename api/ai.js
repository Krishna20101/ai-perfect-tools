import admin from 'firebase-admin';

// Initialize Firebase Admin (only once)
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            privateKey: process.env.FIREBASE_PRIVATE_KEY,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        }),
        databaseURL: "https://ai-perfect-tools-default-rtdb.asia-southeast1.firebasedatabase.app"
    });
}

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Verify Firebase token
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized - No token provided' });
        }

        const idToken = authHeader.split('Bearer ')[1];
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const uid = decodedToken.uid;

        // Check if user has active access
        const userRef = admin.database().ref(`users/${uid}`);
        const userSnap = await userRef.once('value');
        const userData = userSnap.val();

        if (!userData) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (Date.now() >= userData.accessExpiry) {
            return res.status(403).json({ error: 'Access expired. Please unlock access to continue.' });
        }

        // Get request data
        const { messages, maxTokens = 500 } = req.body;

        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ error: 'Invalid request - messages array required' });
        }

        // Call Perplexity AI
        const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;

        if (!PERPLEXITY_API_KEY) {
            return res.status(500).json({ error: 'API key not configured' });
        }

        const response = await fetch('https://api.perplexity.ai/chat/completions', {
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

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error?.message || 'AI API error');
        }

        const data = await response.json();

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
        
        if (error.code === 'auth/id-token-expired') {
            return res.status(401).json({ error: 'Token expired. Please login again.' });
        }

        if (error.code === 'auth/argument-error') {
            return res.status(401).json({ error: 'Invalid token' });
        }

        return res.status(500).json({ 
            error: 'AI service temporarily unavailable',
            message: error.message 
        });
    }
}
