// Learn4Good.com jobs scraper (CheerioCrawler) - FIXED VERSION
import { Actor, log } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';

await Actor.init();

// ------------------------- INPUT -------------------------
const input = await Actor.getInput() ?? {};
const {
    startUrl = '',
    keyword = '',
    location = '',
    posted_date = 'anytime',
    collectDetails = true,
    maxJobs: MAX_JOBS_RAW,
    maxPages: MAX_PAGES_RAW,
    cookies = '',
    proxyConfiguration,
} = input;

// Validate input
if (!startUrl && !keyword) {
    throw new Error('INPUT error: Either "startUrl" or "keyword" field is required.');
}

const MAX_JOBS = Number.isFinite(+MAX_JOBS_RAW) ? Math.max(1, +MAX_JOBS_RAW) : Number.MAX_SAFE_INTEGER;
const MAX_PAGES = Number.isFinite(+MAX_PAGES_RAW) ? Math.max(1, +MAX_PAGES_RAW) : Number.MAX_SAFE_INTEGER;

// ------------------------- HELPERS -------------------------
const buildStartUrl = (kw, loc, date) => {
    // Learn4Good uses PHP-style query parameters for search
    const baseUrl = 'https://www.learn4good.com/jobs/index.php';
    const params = new URLSearchParams();
    
    params.set('controller', 'job_list');
    params.set('action', 'display_search_results');
    params.set('page_number', '1');
    
    if (kw) {
        // Keywords go into 'what' parameter
        params.set('what', kw.trim());
    }
    
    if (loc) {
        // Location goes into 'where' parameter
        params.set('where', loc.trim());
    }
    
    // Add date filtering if needed
    if (date && date !== 'anytime') {
        const dateMap = {
            '24h': '1',
            '7d': '7',
            '30d': '30',
        };
        if (dateMap[date]) {
            params.set('days_posted', dateMap[date]);
        }
    }
    
    return `${baseUrl}?${params.toString()}`;
};

const toAbs = (href) => {
    if (!href) return null;
    try {
        return new URL(href, 'https://www.learn4good.com').href;
    } catch {
        return null;
    }
};

const htmlToText = (html) => {
    if (!html) return '';
    
    return html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|h\d|tr)>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#\d+;/g, '')
        .replace(/\n\s*\n+/g, '\n\n')
        .replace(/[ \t]+/g, ' ')
        .trim();
};

const cleanText = (text) => {
    if (!text) return 'N/A';
    
    return text
        .replace(/\s+/g, ' ')
        .replace(/^\s*[-•]\s*/, '')
        .replace(/\n+/g, ' ')
        .trim() || 'N/A';
};

// ------------------------- START URLS -------------------------
const finalStartUrl = startUrl || buildStartUrl(keyword, location, posted_date);

// ------------------------- PROXY -------------------------
const proxyConf = proxyConfiguration
    ? await Actor.createProxyConfiguration(proxyConfiguration)
    : undefined;

// ------------------------- SHARED STATE -------------------------
let jobsScraped = 0;
let pagesVisited = 0;

// ------------------------- CRAWLER -------------------------
const crawler = new CheerioCrawler({
    proxyConfiguration: proxyConf,
    maxRequestsPerMinute: 40,
    requestHandlerTimeoutSecs: 120,
    navigationTimeoutSecs: 90,
    maxConcurrency: 3,
    useSessionPool: true,
    persistCookiesPerSession: true,
    sessionPoolOptions: {
        maxPoolSize: 15,
        sessionOptions: {
            maxUsageCount: 40,
            maxErrorScore: 3,
        },
    },
    maxRequestRetries: 3,

    preNavigationHooks: [
        ({ request }) => {
            request.headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'DNT': '1',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Cache-Control': 'max-age=0',
            };
            
            if (cookies) {
                request.headers['Cookie'] = cookies;
            }
        },
    ],

    async requestHandler({ request, $, log: crawlerLog, enqueueLinks, session }) {
        const { label = 'LIST' } = request.userData;

        // Check for block/captcha pages
        const title = $('title').text();
        const bodyText = $('body').text();
        
        if (title.includes('Pardon Our Interruption') || 
            title.includes('Just a moment') ||
            bodyText.includes('Verifying you are not a robot') ||
            bodyText.includes('Cloudflare') ||
            bodyText.includes('Ray ID:')) {
            
            crawlerLog.warning(`Detected blocking page. Retiring session.`);
            session.retire();
            throw new Error(`Blocked on ${request.url}`);
        }

        if (label === 'LIST') {
            pagesVisited++;
            crawlerLog.info(`Processing LIST page ${pagesVisited}/${MAX_PAGES}: ${request.url}`);
            
            const jobLinks = [];
            
            // Learn4Good wraps each job in a specific structure
            // Look for job links that match the pattern: /jobs/{location}/{country}/{category}/{id}/e/
            $('a').each((_, el) => {
                const href = $(el).attr('href');
                if (!href) return;
                
                // Match job detail URLs (they contain job ID and end with /e/ or /e)
                if (href.match(/\/jobs\/[^\/]+\/[^\/]+\/[^\/]+\/\d+\/e\/?/)) {
                    const fullUrl = toAbs(href);
                    if (fullUrl && !jobLinks.includes(fullUrl)) {
                        const linkText = cleanText($(el).text());
                        if (linkText !== 'N/A' && linkText.length > 3) {
                            jobLinks.push(fullUrl);
                        }
                    }
                }
            });

            crawlerLog.info(`Found ${jobLinks.length} job links on page ${pagesVisited}`);

            if (jobLinks.length === 0) {
                crawlerLog.warning('No jobs found. May have reached end of results.');
            }

            const remainingSlots = MAX_JOBS - jobsScraped;
            const linksToEnqueue = jobLinks.slice(0, Math.max(0, remainingSlots));

            if (collectDetails && linksToEnqueue.length > 0) {
                await enqueueLinks({
                    urls: linksToEnqueue,
                    userData: { label: 'DETAIL' },
                });
                crawlerLog.info(`Enqueued ${linksToEnqueue.length} detail pages`);
            } else if (!collectDetails) {
                // Extract basic data from listing page
                for (const jobLink of linksToEnqueue) {
                    const linkElement = $(`a[href*="${jobLink.split('/').slice(-3).join('/')}"]`).first();
                    
                    if (linkElement.length === 0) continue;
                    
                    const title = cleanText(linkElement.text());
                    
                    // Try to find associated metadata near the link
                    const container = linkElement.closest('div, article, section, li');
                    const containerText = container.text();
                    
                    // Extract company (usually follows "Listing for:")
                    let company = 'N/A';
                    const companyMatch = containerText.match(/Listing for:\s*([^\n]+)/);
                    if (companyMatch) {
                        company = cleanText(companyMatch[1]);
                    }
                    
                    // Extract location (usually follows "Job in")
                    let location = 'N/A';
                    const locationMatch = containerText.match(/Job in\s+([^,\n]+(?:,\s*[^,\n]+)?)/);
                    if (locationMatch) {
                        location = cleanText(locationMatch[1]);
                    }
                    
                    // Extract date if visible
                    let date_posted = null;
                    const dateMatch = containerText.match(/Listed on\s+(\d{4}-\d{2}-\d{2})/);
                    if (dateMatch) {
                        date_posted = dateMatch[1];
                    }
                    
                    const item = {
                        title,
                        company,
                        location,
                        salary: undefined,
                        job_type: undefined,
                        date_posted,
                        description_html: '',
                        description_text: '',
                        url: jobLink,
                    };

                    await Dataset.pushData(item);
                    jobsScraped++;
                    crawlerLog.info(`✓ Job ${jobsScraped}/${MAX_JOBS}: "${title}" at "${company}"`);
                    
                    if (jobsScraped >= MAX_JOBS) break;
                }
            }

            // Pagination - Learn4Good uses page_number parameter
            if (jobsScraped < MAX_JOBS && pagesVisited < MAX_PAGES) {
                try {
                    const currentUrl = new URL(request.url);
                    const pageNum = parseInt(currentUrl.searchParams.get('page_number') || '1');
                    
                    // Check if there's a next page link
                    let hasNextPage = false;
                    
                    // Look for "Next" or ">" links
                    $('a').each((_, el) => {
                        const href = $(el).attr('href');
                        const text = $(el).text().trim();
                        
                        if (href && (text.toLowerCase().includes('next') || text === '>' || text === '»')) {
                            hasNextPage = true;
                            return false; // break
                        }
                    });
                    
                    // Also check if we have enough jobs to warrant a next page
                    if (jobLinks.length > 5) {
                        hasNextPage = true;
                    }
                    
                    if (hasNextPage && pageNum < 50) { // Safety limit
                        currentUrl.searchParams.set('page_number', (pageNum + 1).toString());
                        const nextUrl = currentUrl.href;
                        
                        await enqueueLinks({
                            urls: [nextUrl],
                            userData: { label: 'LIST' },
                        });
                        crawlerLog.info(`Enqueued next page (${pageNum + 1}): ${nextUrl}`);
                    } else {
                        crawlerLog.info('No more pages to scrape.');
                    }
                } catch (e) {
                    crawlerLog.warning(`Pagination error: ${e.message}`);
                }
            }
        }

        if (label === 'DETAIL') {
            if (jobsScraped >= MAX_JOBS) {
                crawlerLog.info(`Skipping - limit reached: ${request.url}`);
                return;
            }

            crawlerLog.info(`Processing detail: ${request.url}`);

            // Extract job title
            let title = cleanText($('h1').first().text());
            if (title === 'N/A') {
                title = cleanText($('title').text().split('|')[0].split('-')[0]);
            }

            // Extract company - Look for "Listing for:"
            let company = 'N/A';
            $('*').each((_, el) => {
                const text = $(el).text();
                if (text.includes('Listing for:')) {
                    const match = text.match(/Listing for:\s*([^\n]+)/);
                    if (match) {
                        company = cleanText(match[1]);
                        return false; // break
                    }
                }
            });

            // Extract location - Look for "Job in"
            let location = 'N/A';
            $('*').each((_, el) => {
                const text = $(el).text();
                if (text.includes('Job in')) {
                    const match = text.match(/Job in\s+([^,\n]+(?:,\s*[^,\n]+)?)/);
                    if (match) {
                        location = cleanText(match[1]);
                        return false; // break
                    }
                }
            });

            // Extract job type - Look for "Full Time", "Part Time", etc.
            let job_type = undefined;
            const bodyText = $('body').text();
            const typeMatch = bodyText.match(/\b(Full[\s-]?[Tt]ime|Part[\s-]?[Tt]ime|Contract|Temporary|Permanent|Freelance|Internship|Remote)\b/);
            if (typeMatch) {
                job_type = cleanText(typeMatch[1]);
            }

            // Extract employment type from structured text
            $('*').each((_, el) => {
                const text = $(el).text();
                if (text.includes('Employment type')) {
                    const match = text.match(/Employment type[:\s]+([\w\s-]+)/);
                    if (match) {
                        job_type = cleanText(match[1]);
                        return false;
                    }
                }
            });

            // Extract date posted - Look for "Listed on"
            let date_posted = null;
            $('*').each((_, el) => {
                const text = $(el).text();
                if (text.includes('Listed on')) {
                    const match = text.match(/Listed on\s+(\d{4}-\d{2}-\d{2})/);
                    if (match) {
                        date_posted = match[1];
                        return false;
                    }
                }
            });

            // Extract salary if present
            let salary = undefined;
            const salaryMatch = bodyText.match(/\$[\d,]+(?:\s*-\s*\$[\d,]+)?(?:\s*(?:per|\/)\s*(?:hour|year|month|annum))?/i);
            if (salaryMatch) {
                salary = cleanText(salaryMatch[0]);
            }

            // Extract job description
            let description_html = '';
            let description_text = '';

            // The main content is usually in the body, but we need to exclude navigation
            // Find the longest text block that's not navigation
            let bestContent = null;
            let maxLength = 0;

            $('div, section, article').each((_, el) => {
                const $el = $(el);
                
                // Skip if it has too many links (navigation)
                const linkCount = $el.find('a').length;
                const textLength = $el.text().trim().length;
                
                if (linkCount < 10 && textLength > maxLength && textLength > 200) {
                    // Check if it contains job-related keywords
                    const text = $el.text().toLowerCase();
                    if (text.includes('responsibilities') || 
                        text.includes('requirements') || 
                        text.includes('qualifications') ||
                        text.includes('description') ||
                        text.includes('key ') ||
                        text.includes('experience')) {
                        maxLength = textLength;
                        bestContent = $el;
                    }
                }
            });

            if (bestContent) {
                const cleaned = bestContent.clone();
                // Remove navigation and ads
                cleaned.find('script, style, nav, header, footer, .menu, .navigation, .ads, .advertisement').remove();
                
                description_html = cleaned.html() || '';
                description_text = htmlToText(description_html);
                
                // Further clean the description text
                const lines = description_text.split('\n').filter(line => {
                    const trimmed = line.trim();
                    // Remove very short lines and navigation-like text
                    return trimmed.length > 20 && 
                           !trimmed.match(/^(Home|Jobs|Search|Login|Register|Apply|View|Click|Back)$/i);
                });
                description_text = lines.join('\n\n').trim();
            }

            const item = {
                title,
                company,
                location,
                salary,
                job_type,
                date_posted,
                description_html,
                description_text,
                url: request.url,
            };

            await Dataset.pushData(item);
            jobsScraped++;
            crawlerLog.info(`✓ Job ${jobsScraped}/${MAX_JOBS}: "${title}" at "${company}" in "${location}"`);
        }
    },

    failedRequestHandler: async ({ request }, error) => {
        log.error(`Request ${request.url} failed: ${error.message}`);
    },
});

log.info('Starting Learn4Good scraper...');
log.info(`Configuration: MAX_JOBS=${MAX_JOBS}, MAX_PAGES=${MAX_PAGES}, collectDetails=${collectDetails}`);
log.info(`Search params - keyword: ${keyword || 'N/A'}, location: ${location || 'N/A'}, posted_date: ${posted_date}`);
log.info(`Final Start URL: ${finalStartUrl}`);

await crawler.run([finalStartUrl]);
log.info(`✓ Scraping completed. Jobs scraped: ${jobsScraped}, Pages visited: ${pagesVisited}`);

await Actor.exit();