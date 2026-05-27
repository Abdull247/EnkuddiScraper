const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { scrapeHomepage, scrapeVideoPage } = require('./scraper.js'); // ✅ Fixed: Changed scrapeFromURL to scrapeVideoPage
const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for your frontend
app.use(cors({
    origin: '*', // Allow all origins for testing (change this in production)
    credentials: true
}));

app.use(express.json());

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100, // Increased limit
    message: { error: 'Too many requests, please try again later.' }
});

app.use('/api/', limiter);

// Health check
app.get('/', (req, res) => {
    res.json({ 
        status: 'ok', 
        service: 'Enkuddi Scraper API',
        endpoints: [
            'GET /api/homepage?page=1 - Scrape homepage (videos, pagination)',
            'GET /api/video?url={video_url} - Scrape single video page',
            'POST /api/videos - Scrape multiple videos'
        ]
    });
});

// Homepage scraper endpoint
app.get('/api/homepage', async (req, res) => {
    const page = req.query.page || 1;
    const url = page == 1 ? 'https://enkuddi.com' : `https://enkuddi.com/page/${page}`;
    
    try {
        console.log(`Scraping homepage page: ${page}`);
        const data = await scrapeHomepage(url);
        
        if (data && data.success) {
            res.json(data);
        } else {
            res.status(404).json({ error: 'Failed to scrape homepage', success: false });
        }
    } catch (error) {
        console.error('Homepage scraping error:', error);
        res.status(500).json({ error: error.message, success: false });
    }
});

// Video page scraper endpoint
app.get('/api/video', async (req, res) => {
    const url = req.query.url;
    
    if (!url) {
        return res.status(400).json({ error: 'URL parameter is required', success: false });
    }
    
    // Validate URL is from allowed domain
    if (!url.includes('enkuddi.com')) {
        return res.status(400).json({ error: 'Only enkuddi.com URLs are allowed', success: false });
    }
    
    try {
        console.log(`Scraping video: ${url}`);
        const data = await scrapeVideoPage(url); // ✅ Fixed: using scrapeVideoPage instead of scrapeFromURL
        
        if (data && data.success) {
            res.json(data);
        } else {
            res.status(404).json({ error: 'Failed to scrape video', success: false });
        }
    } catch (error) {
        console.error('Video scraping error:', error);
        res.status(500).json({ error: error.message, success: false });
    }
});

// Batch scrape videos
app.post('/api/videos', async (req, res) => {
    const { urls } = req.body;
    
    if (!urls || !Array.isArray(urls)) {
        return res.status(400).json({ error: 'urls array is required', success: false });
    }
    
    if (urls.length > 10) {
        return res.status(400).json({ error: 'Maximum 10 videos per request', success: false });
    }
    
    const results = [];
    for (const url of urls) {
        try {
            const data = await scrapeVideoPage(url); // ✅ Fixed: using scrapeVideoPage
            results.push({ url, success: true, data });
        } catch (error) {
            results.push({ url, success: false, error: error.message });
        }
        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    res.json({ results, success: true });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!', success: false });
});

// Start server
app.listen(PORT, () => {
    console.log(`✅ API Server running on http://localhost:${PORT}`);
    console.log(`📹 Test homepage: http://localhost:${PORT}/api/homepage`);
    console.log(`🎬 Test video: http://localhost:${PORT}/api/video?url=https://enkuddi.com/19-yo-ebony-edging-her-clit-with-a-vibrator`);
});
