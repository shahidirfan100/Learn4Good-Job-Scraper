
// Learn4Good.com jobs scraper (CheerioCrawler)
import { Actor, log } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';

await Actor.init();

// ------------------------- INPUT -------------------------
const input = await Actor.getInput() ?? {};
const {
    keyword = '',
    location = '',
    posted_date = 'anytime',
    results_wanted: RESULTS_WANTED_RAW = 100,
    proxyConfiguration,
} = input;

if (!keyword) {
    throw new Error('INPUT error: The "keyword" field is required.');
}

const RESULTS_WANTED = Number.isFinite(+RESULTS_WANTED_RAW) ? Math.max(1, +RESULTS_WANTED_RAW) : Number.MAX_SAFE_INTEGER;

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
const startUrl = buildStartUrl(keyword, location, posted_date);

// ------------------------- PROXY -------------------------
const proxyConf = proxyConfiguration
    ? await Actor.createProxyConfiguration(proxyConfiguration)
    : undefined;

// ------------------------- SHARED STATE -------------------------
let jobsScraped = 0;

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
            maxUsageCount: 50, // Use each session more
            maxErrorScore: 3,
        },
        // Rotate session on failure
        maxSessionRotations: 10,
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

            const remainingSlots = RESULTS_WANTED - jobsScraped;
            const linksToEnqueue = jobLinks.slice(0, Math.max(0, remainingSlots));

            if (linksToEnqueue.length > 0) {
                await enqueueLinks({
                    urls: linksToEnqueue,
                    userData: { label: 'DETAIL' },
                });
            }

            // Pagination
            if (jobsScraped < RESULTS_WANTED) {
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
            }
        }

        if (label === 'DETAIL') {
            if (jobsScraped >= RESULTS_WANTED) {
                crawlerLog.info(`Skipping detail page as results limit reached: ${request.url}`);
                return;
            }

            const title = $('h1[itemprop="title"]').text().trim();
            const company = $('span[itemprop="name"]').text().trim();
            const location = $('span[itemprop="addressLocality"]').text().trim();
            const date_posted = $('meta[itemprop="datePosted"]').attr('content');

            const descriptionContainer = $('div[itemprop="description"]');
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
            crawlerLog.info(`✓ Job ${jobsScraped}/${RESULTS_WANTED} saved: ${title}`);
        }
    },

    failedRequestHandler: async ({ request }, error) => {
        log.error(`Request ${request.url} failed: ${error.message}`);
    },
});

log.info('Starting scraper...');
await crawler.run([startUrl]);
log.info(`✓ Scraping completed. Total jobs scraped: ${jobsScraped}`);

await Actor.exit();
