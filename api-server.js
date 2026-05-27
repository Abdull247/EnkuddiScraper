const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { scrapeFromURL } = require('./scraper.js'); // Video page scraper
const { scrapeHomepage } = require('./scraper.js'); // Main homepage scraper
const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for your frontend
app.use(cors({
    origin: ['http://localhost:3001', 'https://your-frontend-domain.com'],
    credentials: true
}));

app.use(express.json());

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    message: { error: 'Too many requests, please try again later.' }
});

app.use('/api/', limiter);

// Health check
app.get('/', (req, res) => {
    res.json({ 
        status: 'ok', 
        service: 'Enkuddi Scraper API',
        endpoints: [
            'GET /api/homepage - Scrape homepage (videos, pagination)',
            'GET /api/video?url={video_url} - Scrape single video page',
            'POST /api/videos - Scrape multiple videos',
            'GET /api/health'
        ]
    });
});

// ✅ NEW: Homepage scraper endpoint
app.get('/api/homepage', async (req, res) => {
    const page = req.query.page || 1;
    const url = page === 1 ? 'https://enkuddi.com' : `https://enkuddi.com/page/${page}`;
    
    try {
        console.log(`Scraping homepage page: ${page}`);
        const data = await scrapeHomepage(url);
        
        if (data) {
            res.json({
                success: true,
                page: parseInt(page),
                data: data
            });
        } else {
            res.status(404).json({ error: 'Failed to scrape homepage' });
        }
    } catch (error) {
        console.error('Homepage scraping error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Video page scraper endpoint
app.get('/api/video', async (req, res) => {
    const url = req.query.url;
    
    if (!url) {
        return res.status(400).json({ error: 'URL parameter is required' });
    }
    
    if (!url.includes('enkuddi.com')) {
        return res.status(400).json({ error: 'Only enkuddi.com URLs are allowed' });
    }
    
    try {
        console.log(`Scraping video: ${url}`);
        const data = await scrapeFromURL(url);
        
        if (data) {
            res.json({
                success: true,
                data: data
            });
        } else {
            res.status(404).json({ error: 'Failed to scrape video' });
        }
    } catch (error) {
        console.error('Video scraping error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Batch scrape videos
app.post('/api/videos', async (req, res) => {
    const { urls } = req.body;
    
    if (!urls || !Array.isArray(urls)) {
        return res.status(400).json({ error: 'urls array is required' });
    }
    
    if (urls.length > 10) {
        return res.status(400).json({ error: 'Maximum 10 videos per request' });
    }
    
    const results = [];
    for (const url of urls) {
        try {
            const data = await scrapeFromURL(url);
            results.push({ url, success: true, data });
        } catch (error) {
            results.push({ url, success: false, error: error.message });
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    res.json({ results });
});

app.listen(PORT, () => {
    console.log(`API Server running on http://localhost:${PORT}`);
});
