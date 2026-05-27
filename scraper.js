const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = 'https://enkuddi.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Fetch HTML of a given URL
 */
async function fetchHTML(url) {
    try {
        const response = await axios.get(url, {
            headers: { 'User-Agent': USER_AGENT },
            timeout: 10000,
        });
        return response.data;
    } catch (error) {
        console.error(`Error fetching ${url}:`, error.message);
        return null;
    }
}

/**
 * Extract all images from the page that are NOT part of video cards
 */
function extractOtherImages($, videoThumbnailsSet) {
    const images = new Set();
    $('img').each((_, el) => {
        let src = $(el).attr('src');
        let dataSrc = $(el).attr('data-src');
        let finalSrc = src && !src.startsWith('data:image') ? src : dataSrc;
        if (finalSrc && finalSrc.trim() !== '') {
            const absolute = finalSrc.startsWith('http') ? finalSrc : new URL(finalSrc, BASE_URL).href;
            if (!videoThumbnailsSet.has(absolute)) {
                images.add(absolute);
            }
        }
    });
    return Array.from(images);
}

/**
 * Extract video information from each .after-dark-card
 */
function extractVideos($) {
    const videos = [];
    const videoThumbnails = new Set();

    $('.after-dark-card').each((_, card) => {
        const titleLink = $(card).find('h2 a');
        const title = titleLink.text().trim();
        const url = titleLink.attr('href') ? new URL(titleLink.attr('href'), BASE_URL).href : null;

        const img = $(card).find('figure img');
        let thumb = img.attr('data-src') || img.attr('src');
        if (thumb && thumb.startsWith('//')) thumb = 'https:' + thumb;
        const thumbnail = thumb ? (thumb.startsWith('http') ? thumb : new URL(thumb, BASE_URL).href) : null;
        if (thumbnail) videoThumbnails.add(thumbnail);

        const timestampElem = $(card).find('.fa-clock').parent();
        const timestamp = timestampElem.text().trim();

        const viewsElem = $(card).find('.fa-eye').parent();
        const views = viewsElem.text().trim();

        if (title && url) {
            videos.push({
                title,
                url,
                thumbnail,
                timestamp,
                views,
            });
        }
    });

    return { videos, videoThumbnails };
}

/**
 * Extract pagination links
 */
function extractPaginationLinks($) {
    const links = new Set();
    $('.join .btn').each((_, el) => {
        let href = $(el).attr('href');
        if (href && href.includes('/page/')) {
            links.add(new URL(href, BASE_URL).href);
        }
    });
    $('a.next').each((_, el) => {
        let href = $(el).attr('href');
        if (href) links.add(new URL(href, BASE_URL).href);
    });
    return Array.from(links);
}

/**
 * Extract page metadata
 */
function extractPageMetadata($) {
    return {
        title: $('title').first().text().trim(),
        metaDescription: $('meta[name="description"]').attr('content') || '',
        canonical: $('link[rel="canonical"]').attr('href') || BASE_URL,
    };
}

/**
 * Extract external resources
 */
function extractResources($) {
    const scripts = [];
    $('script[src]').each((_, el) => {
        let src = $(el).attr('src');
        if (src) scripts.push(src.startsWith('http') ? src : new URL(src, BASE_URL).href);
    });
    const styles = [];
    $('link[rel="stylesheet"]').each((_, el) => {
        let href = $(el).attr('href');
        if (href) styles.push(href.startsWith('http') ? href : new URL(href, BASE_URL).href);
    });
    return { scripts, styles };
}

/**
 * ============================================
 * HOMEPAGE SCRAPER (for video listings)
 * ============================================
 */
async function scrapeHomepage(startUrl = BASE_URL) {
    console.log(`Fetching homepage: ${startUrl} ...`);
    const html = await fetchHTML(startUrl);
    if (!html) return null;

    const $ = cheerio.load(html);

    const { videos, videoThumbnails } = extractVideos($);
    const otherImages = extractOtherImages($, videoThumbnails);
    const paginationLinks = extractPaginationLinks($);
    const pageMetadata = extractPageMetadata($);
    const resources = extractResources($);

    // Extract top categories menu
    const categories = [];
    $('#menu-top-categories .menu-item a').each((_, el) => {
        categories.push({
            name: $(el).text().trim(),
            url: $(el).attr('href')
        });
    });

    // Extract top countries menu
    const countries = [];
    $('#menu-top-countries .menu-item a').each((_, el) => {
        countries.push({
            name: $(el).text().trim(),
            url: $(el).attr('href')
        });
    });

    return {
        success: true,
        pageUrl: startUrl,
        pageMetadata,
        videos,
        categories,
        countries,
        otherImages,
        paginationLinks,
        resources,
        totalVideos: videos.length,
        currentPage: startUrl.includes('/page/') ? parseInt(startUrl.split('/page/')[1]) : 1
    };
}

/**
 * ============================================
 * VIDEO PAGE SCRAPER (for individual video details)
 * ============================================
 */

/**
 * Extract video URL from video page
 */
function extractVideoUrl($) {
    // Method 1: Direct video src
    let videoSrc = $('video[src]').attr('src');
    if (videoSrc) return videoSrc.startsWith('http') ? videoSrc : new URL(videoSrc, BASE_URL).href;
    
    // Method 2: Video source child element
    videoSrc = $('video source').attr('src');
    if (videoSrc) return videoSrc.startsWith('http') ? videoSrc : new URL(videoSrc, BASE_URL).href;
    
    // Method 3: data-plyr-config
    const plyrConfig = $('.plyr-video').attr('data-plyr-config');
    if (plyrConfig) {
        try {
            const config = JSON.parse(plyrConfig);
            if (config && config.source && config.source.sources && config.source.sources[0]) {
                return config.source.sources[0].src;
            }
        } catch(e) {}
    }
    
    // Method 4: Search scripts for video URLs
    let foundUrl = null;
    $('script').each((_, el) => {
        const scriptContent = $(el).html();
        if (scriptContent) {
            const matches = scriptContent.match(/https?:\/\/[^"'\s]+\.(mp4|m3u8|webm|mov)[^"'\s]*/gi);
            if (matches && matches.length) {
                foundUrl = matches[0];
                return false;
            }
        }
    });
    
    return foundUrl;
}

/**
 * Extract performer information
 */
function extractPerformer($) {
    const performer = {};
    const performerContainer = $('.performers-wrapper');
    if (performerContainer.length) {
        performer.name = performerContainer.find('.performer-info a:first-child').text().trim();
        performer.url = performerContainer.find('.performer-info a:first-child').attr('href');
        if (performer.url && !performer.url.startsWith('http')) {
            performer.url = new URL(performer.url, BASE_URL).href;
        }
        performer.avatar = performerContainer.find('.avatar img').attr('src');
        if (performer.avatar && !performer.avatar.startsWith('http')) {
            performer.avatar = new URL(performer.avatar, BASE_URL).href;
        }
        const countryLink = performerContainer.find('.performer-info a:last-child');
        performer.country = {
            name: countryLink.text().trim(),
            url: countryLink.attr('href') ? new URL(countryLink.attr('href'), BASE_URL).href : null,
            flagClass: countryLink.find('span').attr('class') || ''
        };
    }
    return performer;
}

/**
 * Extract categories and tags from video page
 */
function extractTaxonomies($) {
    const categories = [];
    $('.post_categories a').each((_, el) => {
        categories.push({
            name: $(el).text().trim(),
            url: $(el).attr('href') ? new URL($(el).attr('href'), BASE_URL).href : null
        });
    });

    const tags = [];
    $('.post_tags a').each((_, el) => {
        tags.push({
            name: $(el).text().trim(),
            url: $(el).attr('href') ? new URL($(el).attr('href'), BASE_URL).href : null
        });
    });

    return { categories, tags };
}

/**
 * Extract related videos from video page
 */
function extractRelatedVideos($) {
    const related = [];
    
    $('.after-dark-card').each((_, card) => {
        const title = $(card).find('h2 a').text().trim();
        const url = $(card).find('h2 a').attr('href');
        const thumbnail = $(card).find('img').attr('src') || $(card).find('img').attr('data-src');
        const date = $(card).find('.fa-clock').parent().text().trim();
        const views = $(card).find('.fa-eye').parent().text().trim();
        
        if (title && url) {
            related.push({
                title,
                url: url.startsWith('http') ? url : new URL(url, BASE_URL).href,
                thumbnail: thumbnail ? (thumbnail.startsWith('http') ? thumbnail : new URL(thumbnail, BASE_URL).href) : null,
                date,
                views
            });
        }
    });
    
    return related;
}

/**
 * Extract text content from the "About" section
 */
function extractExcerpt($) {
    const excerptText = $('.post_excerpt .content').text().trim();
    return excerptText;
}

/**
 * Extract JSON-LD structured data
 */
function extractJsonLd($) {
    const jsonLd = [];
    $('script[type="application/ld+json"]').each((_, el) => {
        try {
            const data = JSON.parse($(el).html());
            jsonLd.push(data);
        } catch (e) {
            // ignore invalid JSON
        }
    });
    return jsonLd;
}

/**
 * Scrape individual video page
 */
async function scrapeVideoPage(url) {
    console.log(`Fetching video page: ${url} ...`);
    const html = await fetchHTML(url);
    if (!html) return null;

    const $ = cheerio.load(html);

    // Basic page info
    const title = $('title').first().text().trim();
    const metaDescription = $('meta[name="description"]').attr('content') || '';
    const canonicalUrl = $('link[rel="canonical"]').attr('href') || '';

    // Video details
    const videoUrl = extractVideoUrl($);
    const videoTitle = $('h1.entry-title').text().trim();
    const thumbnail = $('meta[property="og:image"]').attr('content') || '';
    const excerpt = extractExcerpt($);

    // Performer
    const performer = extractPerformer($);

    // Taxonomies
    const { categories, tags } = extractTaxonomies($);

    // Related videos
    const relatedVideos = extractRelatedVideos($);

    // All images from page
    const images = [];
    $('img').each((_, el) => {
        let src = $(el).attr('src');
        let dataSrc = $(el).attr('data-src');
        let finalSrc = src && !src.startsWith('data:image') ? src : dataSrc;
        if (finalSrc && finalSrc.trim() !== '') {
            const absolute = finalSrc.startsWith('http') ? finalSrc : new URL(finalSrc, BASE_URL).href;
            images.push(absolute);
        }
    });

    // JSON-LD
    const jsonLd = extractJsonLd($);

    return {
        success: true,
        page: {
            url: url,
            title,
            metaDescription,
            canonicalUrl,
            jsonLd
        },
        video: {
            title: videoTitle,
            url: videoUrl,
            thumbnail: thumbnail ? (thumbnail.startsWith('http') ? thumbnail : new URL(thumbnail, BASE_URL).href) : null,
            excerpt
        },
        performer,
        categories,
        tags,
        relatedVideos,
        images: [...new Set(images)] // deduplicate images
    };
}

/**
 * ============================================
 * EXPORTS AND CLI
 * ============================================
 */

module.exports = { 
    scrapeHomepage, 
    scrapeVideoPage,
    fetchHTML,
    extractVideos,
    extractPaginationLinks,
    extractPerformer,
    extractTaxonomies,
    extractRelatedVideos
};

// CLI handling
if (require.main === module) {
    const args = process.argv.slice(2);
    const type = args[0]; // 'homepage' or 'video'
    const url = args[1];
    
    if (type === 'homepage') {
        const page = url || BASE_URL;
        scrapeHomepage(page).then(data => {
            if (data) {
                console.log(JSON.stringify(data, null, 2));
            } else {
                console.error('Homepage scraping failed.');
            }
        });
    } else if (type === 'video' && url) {
        scrapeVideoPage(url).then(data => {
            if (data) {
                console.log(JSON.stringify(data, null, 2));
            } else {
                console.error('Video scraping failed.');
            }
        });
    } else {
        console.log('Usage:');
        console.log('  node scraper.js homepage [page_url]');
        console.log('  node scraper.js video <video_url>');
        console.log('\nExamples:');
        console.log('  node scraper.js homepage');
        console.log('  node scraper.js homepage https://enkuddi.com/page/2');
        console.log('  node scraper.js video https://enkuddi.com/19-yo-ebony-edging-her-clit-with-a-vibrator');
    }
}