
// Learn4Good.com jobs scraper (CheerioCrawler)
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
    // Learn4Good URL pattern: https://www.learn4good.com/jobs/language/english/search/engineering/
    const baseUrl = 'https://www.learn4good.com/jobs/language/english/search';
    
    let url = baseUrl;
    
    if (kw) {
        // Clean and format keyword for URL
        const cleanKeyword = kw.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '-');
        url += `/${cleanKeyword}`;
    }
    
    if (loc) {
        // Add location if provided
        const cleanLocation = loc.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '-');
        url += `/${cleanLocation}`;
    }
    
    url += '/'; // Always end with slash
    
    // Add query parameters for date filtering if needed
    if (date && date !== 'anytime') {
        const params = new URLSearchParams();
        const dateMap = {
            '24h': '1',
            '7d': '7', 
            '30d': '30',
        };
        if (dateMap[date]) {
            params.set('days', dateMap[date]);
        }
        if (params.toString()) {
            url += '?' + params.toString();
        }
    }
    
    return url;
};

const toAbs = (href) => {
    try {
        return new URL(href, 'https://www.learn4good.com').href;
    } catch {
        return null;
    }
};

const htmlToText = (html) => (html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

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
    maxRequestsPerMinute: 60,  // Reduced to be more conservative
    requestHandlerTimeoutSecs: 120,
    navigationTimeoutSecs: 90,
    maxConcurrency: 5,  // Reduced concurrency
    useSessionPool: true,
    persistCookiesPerSession: true,
    sessionPoolOptions: {
        maxPoolSize: 20,
        sessionOptions: {
            maxUsageCount: 30,
            maxErrorScore: 5,
        },
    },
    maxRequestRetries: 3,

    preNavigationHooks: [
        ({ request, session }) => {
            request.headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
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
            
            // Add custom cookies if provided
            if (cookies) {
                request.headers['Cookie'] = cookies;
            }
        },
    ],

    async requestHandler({ request, $, log: crawlerLog, enqueueLinks, session }) {
        const { label = 'LIST' } = request.userData;

        // Check for block page indicators
        const title = $('title').text();
        const bodyText = $('body').text();
        
        if (title.includes('Pardon Our Interruption') || 
            title.includes('Just a moment') ||
            bodyText.includes('Verifying you are not a robot') ||
            bodyText.includes('Cloudflare') ||
            bodyText.includes('Ray ID:')) {
            
            crawlerLog.warning(`Detected blocking page. Title: ${title.substring(0, 100)}`);
            session.retire(); // Retire the session that got blocked
            throw new Error(`Blocked on page ${request.url}, retiring session.`);
        }

        if (label === 'LIST') {
            pagesVisited++;
            crawlerLog.info(`Processing LIST page ${pagesVisited}/${MAX_PAGES}: ${request.url}`);
            
            // Debug: Log page title and basic info
            const pageTitle = $('title').text();
            const bodyText = $('body').text().substring(0, 200);
            crawlerLog.info(`Page title: ${pageTitle}`);
            crawlerLog.info(`Body preview: ${bodyText}...`);
            
            const jobLinks = [];
            
            // Look for job links - Learn4Good typically uses these patterns
            const selectors = [
                'a[href*="/jobs/"]',     // Jobs with /jobs/ in URL
                'a[href*="/job/"]',      // Jobs with /job/ in URL  
                '.job-title a',          // Job title links
                'h3 a',                  // Header links (common pattern)
                'h4 a',                  // Header links
                'a.job_link',            // Original selector
                'div[class*="job"] a'    // Any div with "job" in class
            ];
            
            for (const selector of selectors) {
                $(selector).each((_, el) => {
                    const href = $(el).attr('href');
                    if (href && (href.includes('/job') || href.includes('/position') || href.includes('/vacancy'))) {
                        const fullUrl = toAbs(href);
                        if (fullUrl && !jobLinks.includes(fullUrl)) {
                            jobLinks.push(fullUrl);
                        }
                    }
                });
                
                if (jobLinks.length > 0) {
                    crawlerLog.info(`Found ${jobLinks.length} jobs using selector: ${selector}`);
                    break; // Use the first selector that works
                }
            }

            crawlerLog.info(`LIST page: Found ${jobLinks.length} jobs on ${request.url}`);

            if (jobLinks.length === 0) {
                crawlerLog.warning('No jobs found on this page. This might be the end of the results.');
                // Debug: Log all links found on page
                const allLinks = [];
                $('a').each((_, el) => {
                    const href = $(el).attr('href');
                    if (href) allLinks.push(href);
                });
                crawlerLog.info(`All links on page (first 10): ${allLinks.slice(0, 10).join(', ')}`);
            }

            const remainingSlots = MAX_JOBS - jobsScraped;
            const linksToEnqueue = jobLinks.slice(0, Math.max(0, remainingSlots));

            if (collectDetails && linksToEnqueue.length > 0) {
                await enqueueLinks({
                    urls: linksToEnqueue,
                    userData: { label: 'DETAIL' },
                });
            } else if (!collectDetails) {
                // Save job data from listing page only
                for (const jobLink of linksToEnqueue) {
                    // Try to find the job element containing this link
                    let jobElement = $(`a[href="${jobLink}"]`).first();
                    if (jobElement.length === 0) {
                        // Try partial match
                        const linkPart = jobLink.split('/').pop();
                        jobElement = $(`a[href*="${linkPart}"]`).first();
                    }
                    
                    // Get parent container
                    const container = jobElement.closest('div, li, tr, article').length > 0 
                        ? jobElement.closest('div, li, tr, article')
                        : jobElement.parent();
                    
                    const title = container.find('h1, h2, h3, h4, .job-title, .title').first().text().trim() 
                        || jobElement.text().trim() 
                        || 'N/A';
                        
                    const company = container.find('.company, .employer, .org, .organization').first().text().trim() || 'N/A';
                    const location = container.find('.location, .job-location, .city, .place').first().text().trim() || 'N/A';
                    
                    const item = {
                        title,
                        company,
                        location,
                        date_posted: null,
                        description_html: '',
                        description_text: '',
                        url: jobLink,
                    };

                    await Dataset.pushData(item);
                    jobsScraped++;
                    crawlerLog.info(`✓ Job ${jobsScraped}/${MAX_JOBS} saved (listing only): ${title}`);
                    
                    if (jobsScraped >= MAX_JOBS) break;
                }
            }

            // Pagination
            if (jobsScraped < MAX_JOBS && pagesVisited < MAX_PAGES) {
                const nextPageLink = $('a:contains("Next")').attr('href');
                if (nextPageLink) {
                    await enqueueLinks({
                        urls: [toAbs(nextPageLink)],
                        userData: { label: 'LIST' },
                    });
                    crawlerLog.info('Enqueued next page.');
                } else {
                    crawlerLog.info('No next page link found. Ending pagination.');
                }
            } else if (pagesVisited >= MAX_PAGES) {
                crawlerLog.info(`Reached maximum pages limit (${MAX_PAGES}). Stopping pagination.`);
            }
        }

        if (label === 'DETAIL') {
            if (jobsScraped >= MAX_JOBS) {
                crawlerLog.info(`Skipping detail page as results limit reached: ${request.url}`);
                return;
            }

            const title = $('h1[itemprop="title"]').text().trim() || $('h1').first().text().trim() || 'N/A';
            const company = $('span[itemprop="name"]').text().trim() || $('.company-name, .employer').first().text().trim() || 'N/A';
            const location = $('span[itemprop="addressLocality"]').text().trim() || $('.location, .job-location').first().text().trim() || 'N/A';
            const date_posted = $('meta[itemprop="datePosted"]').attr('content') || $('.date-posted, .job-date').first().text().trim() || null;

            const descriptionContainer = $('div[itemprop="description"]').length > 0 
                ? $('div[itemprop="description"]') 
                : $('.job-description, .description, .job-content').first();
            const description_html = descriptionContainer.html() || '';
            const description_text = htmlToText(description_html);

            const item = {
                title,
                company,
                location,
                date_posted,
                description_html,
                description_text,
                url: request.url,
            };

            await Dataset.pushData(item);
            jobsScraped++;
            crawlerLog.info(`✓ Job ${jobsScraped}/${MAX_JOBS} saved: ${title}`);
        }
    },

    failedRequestHandler: async ({ request }, error) => {
        log.error(`Request ${request.url} failed: ${error.message}`);
    },
});

log.info('Starting scraper...');
log.info(`Configuration: MAX_JOBS=${MAX_JOBS}, MAX_PAGES=${MAX_PAGES}, collectDetails=${collectDetails}`);
log.info(`Input - startUrl: ${startUrl || 'Not provided'}, keyword: ${keyword || 'Not provided'}, location: ${location || 'Not provided'}`);
log.info(`Final Start URL: ${finalStartUrl}`);

await crawler.run([finalStartUrl]);
log.info(`✓ Scraping completed. Total jobs scraped: ${jobsScraped}, Pages visited: ${pagesVisited}`);

await Actor.exit();
