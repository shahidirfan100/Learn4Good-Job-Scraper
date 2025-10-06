
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
    const url = new URL('https://www.learn4good.com/jobs/search/');
    url.pathname += `${encodeURIComponent(kw).replace(/%20/g, '-')}/`;
    if (loc) {
        url.pathname += `${encodeURIComponent(loc).replace(/%20/g, '-')}/`;
    }

    const params = new URLSearchParams();
    if (date && date !== 'anytime') {
        const dateMap = {
            '24h': '1',
            '7d': '7',
            '30d': '30',
        };
        if (dateMap[date]) {
            params.set('date_posted', dateMap[date]);
        }
    }
    url.search = params.toString();
    return url.href;
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
    maxRequestsPerMinute: 120,
    requestHandlerTimeoutSecs: 45,
    navigationTimeoutSecs: 60,
    maxConcurrency: 10,
    useSessionPool: true,
    persistCookiesPerSession: true,
    sessionPoolOptions: {
        maxPoolSize: 50,
        sessionOptions: {
            maxUsageCount: 50,
            maxErrorScore: 3,
        },
    },

    preNavigationHooks: [
        ({ request, session }) => {
            request.headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cache-Control': 'max-age=0',
                'Sec-CH-UA': '"Not?A_Brand";v="8", "Chromium";v="108", "Google Chrome";v="108"',
                'Sec-CH-UA-Mobile': '?0',
                'Sec-CH-UA-Platform': '"Windows"',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Upgrade-Insecure-Requests': '1',
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
        if ($('title').text().includes('Pardon Our Interruption') || $('body').text().includes('Verifying you are not a robot')) {
            session.retire(); // Retire the session that got blocked
            throw new Error(`Blocked on page ${request.url}, retiring session.`);
        }

        if (label === 'LIST') {
            pagesVisited++;
            crawlerLog.info(`Processing LIST page ${pagesVisited}/${MAX_PAGES}: ${request.url}`);
            
            const jobLinks = [];
            $('a.job_link').each((_, el) => {
                const href = $(el).attr('href');
                if (href) {
                    jobLinks.push(toAbs(href));
                }
            });

            crawlerLog.info(`LIST page: Found ${jobLinks.length} jobs on ${request.url}`);

            if (jobLinks.length === 0) {
                crawlerLog.warning('No jobs found on this page. This might be the end of the results.');
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
                    const jobElement = $(`a.job_link[href*="${jobLink.split('/').pop()}"]`).closest('.job-item, .job-listing, .job');
                    const title = jobElement.find('h2, h3, .job-title').first().text().trim() || 'N/A';
                    const company = jobElement.find('.company, .employer').first().text().trim() || 'N/A';
                    const location = jobElement.find('.location, .job-location').first().text().trim() || 'N/A';
                    
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
log.info(`Start URL: ${finalStartUrl}`);

await crawler.run([finalStartUrl]);
log.info(`✓ Scraping completed. Total jobs scraped: ${jobsScraped}, Pages visited: ${pagesVisited}`);

await Actor.exit();
