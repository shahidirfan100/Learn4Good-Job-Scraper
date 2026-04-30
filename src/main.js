import { Actor, log } from 'apify';
import * as cheerio from 'cheerio';
import { CheerioCrawler, Dataset } from 'crawlee';

await Actor.init();

const input = (await Actor.getInput()) ?? {};
const {
    startUrl = '',
    keyword = 'nurse',
    location = 'New York',
    maxJobs: maxJobsRaw,
    cookies = '',
    proxyConfiguration,
} = input;

const SITE_ORIGIN = 'https://www.learn4good.com';
const LIST_LABEL = 'LIST';
const INTERNAL_POSTED_DATE = 'anytime';
const DATASET_FLUSH_SIZE = 50;

/**
 * Normalize input values into non-empty strings.
 * @param {unknown} value
 * @returns {string[]}
 */
const toNonEmptyStrings = (value) => {
    if (value == null) return [];

    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed ? [trimmed] : [];
    }

    if (Array.isArray(value)) {
        return value
            .filter((item) => item != null)
            .map((item) => String(item).trim())
            .filter(Boolean);
    }

    return [];
};

/**
 * Trim and normalize text.
 * @param {unknown} value
 * @returns {string}
 */
const cleanText = (value) => {
    if (!value) return '';

    return String(value)
        .replace(/\s+/g, ' ')
        .replace(/^\s*[-•]\s*/, '')
        .trim();
};

/**
 * Keep only city/region-style location text.
 * @param {unknown} value
 * @returns {string}
 */
const formatLocation = (value) => {
    const normalized = cleanText(value);
    if (!normalized) return '';

    const parts = normalized
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);

    if (!parts.length) return '';

    const first = parts[0];
    const last = parts[parts.length - 1];

    if (/^\d/.test(first) || /^\d{5}(-\d{4})?$/.test(first) || /^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/i.test(first)) {
        return last;
    }

    return parts.length === 1 ? first : `${first}, ${last}`;
};

/**
 * Convert basic HTML content into plain text.
 * @param {string} html
 * @returns {string}
 */
const htmlToText = (html) => {
    if (!html) return '';

    return html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|h\d|tr|td|section|article)>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#\d+;/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n+/g, '\n\n')
        .trim();
};

/**
 * Keep safe formatting tags from description HTML.
 * @param {string} rawHtml
 * @returns {string}
 */
const sanitizeDescriptionHtml = (rawHtml) => {
    if (!rawHtml) return '';

    const $ = cheerio.load(`<div id="__desc_root__">${rawHtml}</div>`, { decodeEntities: false });
    const root = $('#__desc_root__');

    root.find('script,style,noscript,iframe,canvas,svg,form,input,button,select,option,nav,header,footer,img,#logo').remove();
    root.find('a').each((_, el) => {
        $(el).replaceWith($(el).text());
    });

    const allowedTags = new Set(['strong', 'b', 'u', 'em', 'i', 'ul', 'ol', 'li', 'p', 'br']);
    root.find('*').each((_, el) => {
        const tagName = (el.tagName || '').toLowerCase();
        const node = $(el);

        if (!allowedTags.has(tagName)) {
            node.replaceWith(node.contents());
            return;
        }

        const attrs = el.attribs ? Object.keys(el.attribs) : [];
        for (const attr of attrs) {
            node.removeAttr(attr);
        }
    });

    return (root.html() || '')
        .replace(/<br\s*\/?>\s*(<br\s*\/?>\s*){2,}/gi, '<br><br>')
        .replace(/(?:\s|&nbsp;){3,}/g, ' ')
        .trim();
};

/**
 * Recursively remove empty fields and normalize string/array values.
 * @param {Record<string, any>} record
 * @returns {Record<string, any>}
 */
const sanitizeRecord = (record) => {
    const out = {};

    for (const [key, value] of Object.entries(record)) {
        if (value == null) continue;

        if (Array.isArray(value)) {
            const cleaned = [...new Set(value.map((item) => cleanText(item)).filter(Boolean))];
            if (cleaned.length) out[key] = cleaned;
            continue;
        }

        if (typeof value === 'object') {
            const nested = sanitizeRecord(value);
            if (Object.keys(nested).length) out[key] = nested;
            continue;
        }

        const cleaned = typeof value === 'string' ? cleanText(value) : value;
        if (cleaned === '') continue;
        out[key] = cleaned;
    }

    return out;
};

/**
 * Resolve URL against Learn4Good origin.
 * @param {string} href
 * @returns {string | null}
 */
const toAbs = (href) => {
    if (!href) return null;

    try {
        return new URL(href, SITE_ORIGIN).href;
    } catch {
        return null;
    }
};

/**
 * Build Learn4Good job search URL.
 * @param {string} kw
 * @param {string} loc
 * @param {string} postedDate
 * @returns {string}
 */
const buildStartUrl = (kw, loc, postedDate) => {
    const baseUrl = `${SITE_ORIGIN}/jobs/index.php`;
    const params = new URLSearchParams();

    params.set('controller', 'job_list');
    params.set('action', 'display_search_results');
    params.set('page_number', '1');

    if (kw) params.set('what', kw.trim());
    if (loc) params.set('where', loc.trim());

    if (postedDate && postedDate !== 'anytime') {
        const dateMap = { '24h': '1', '7d': '7', '30d': '30' };
        if (dateMap[postedDate]) {
            params.set('days_posted', dateMap[postedDate]);
        }
    }

    return `${baseUrl}?${params.toString()}`;
};

/**
 * Extract numeric job ID from Learn4Good URL.
 * @param {string} url
 * @returns {string}
 */
const extractJobIdFromUrl = (url) => {
    const match = String(url).match(/\/(\d+)\/e\/?/);
    return match ? match[1] : '';
};

/**
 * Build text-based fingerprint for dedupe fallback.
 * @param {Record<string, any>} record
 * @returns {string}
 */
const buildRecordFingerprint = (record) => {
    const normalizedText = cleanText(record.description_text || '')
        .toLowerCase()
        .slice(0, 500);

    return [
        cleanText(record.title || '').toLowerCase(),
        cleanText(record.company || '').toLowerCase(),
        cleanText(record.location || '').toLowerCase(),
        cleanText(record.date_posted || '').toLowerCase(),
        normalizedText,
    ].join('|');
};

/**
 * Detect anti-bot responses.
 * @param {import('cheerio').CheerioAPI} $
 * @returns {boolean}
 */
const isBlockedPage = ($) => {
    const title = $('title').text();
    if (title.includes('Pardon Our Interruption') || title.includes('Just a moment') || title.includes('Access Denied')) {
        return true;
    }

    const bodyText = $('body').text();
    return /verifying you are not a robot|cloudflare|ray id:/i.test(bodyText);
};

/**
 * Extract the next list page URL.
 * @param {import('cheerio').CheerioAPI} $
 * @param {string} currentUrl
 * @returns {string | null}
 */
const getNextListUrl = ($, currentUrl) => {
    const nextSelectors = [
        'a[title*="Next"]',
        'a[title*="next"]',
        'a:contains("Next")',
        'a:contains("next")',
        '.pagination a:last',
    ];

    for (const selector of nextSelectors) {
        const href = $(selector).first().attr('href');
        if (!href || href.includes('javascript')) continue;

        const resolved = toAbs(href);
        if (resolved) return resolved;
    }

    const morePathMatch = currentUrl.match(/\/more(\d+)\/?$/i);
    if (morePathMatch) {
        const nextPageNumber = Number(morePathMatch[1]) + 1;
        return currentUrl.replace(/\/more\d+\/?$/i, `/more${nextPageNumber}/`);
    }

    try {
        const parsed = new URL(currentUrl);
        const currentPage = Number.parseInt(parsed.searchParams.get('page_number') || '1', 10);
        if (Number.isFinite(currentPage) && currentPage >= 1) {
            parsed.searchParams.set('page_number', String(currentPage + 1));
            return parsed.href;
        }
    } catch {
        return null;
    }

    return null;
};

const startUrls = toNonEmptyStrings(input.startUrl ?? input.startUrls ?? startUrl);
const keywords = toNonEmptyStrings(input.keyword ?? input.keywords ?? keyword);

if (!startUrls.length && !keywords.length) {
    throw new Error('INPUT error: provide either `startUrl` or `keyword`.');
}

const maxJobs = Number.isFinite(+maxJobsRaw) ? Math.max(1, +maxJobsRaw) : 20;
const hardSafetyMaxPages = Math.min(500, Math.max(30, Math.ceil(maxJobs / 2)));
const finalStartUrl = startUrls[0] || buildStartUrl(keywords[0] || '', location, INTERNAL_POSTED_DATE);

const proxyOptions =
    proxyConfiguration && Object.keys(proxyConfiguration).length > 0
        ? proxyConfiguration
        : { useApifyProxy: true, groups: ['DATACENTER'] };

let proxyConf;
try {
    proxyConf = await Actor.createProxyConfiguration(proxyOptions);
} catch (error) {
    if (!proxyConfiguration && proxyOptions.groups) {
        log.warning(`Default proxy group unavailable (${error.message}). Falling back to Apify Proxy auto selection.`);
        proxyConf = await Actor.createProxyConfiguration({ useApifyProxy: true });
    } else {
        throw error;
    }
}

let jobsScraped = 0;
let pagesVisited = 0;
let duplicatesSkipped = 0;
let detailFailures = 0;
let cumulativeLinksFound = 0;

const discoveredDetailRequests = [];
const discoveredJobKeys = new Set();
const seenListUrls = new Set();
const seenRecordUrls = new Set();
const seenRecordJobIds = new Set();
const seenFingerprints = new Set();
const pendingDatasetItems = [];

const commonHeaders = {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    DNT: '1',
    Connection: 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0',
    Referer: `${SITE_ORIGIN}/`,
};

const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
];

/**
 * Attach headers and optional cookies for each request.
 * @param {{ request: any, session?: any }} ctx
 */
const applyHeaders = ({ request, session }) => {
    request.headers = {
        ...commonHeaders,
        'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
    };

    if (cookies) {
        request.headers.Cookie = cookies;
    }

    if (session) void session;
};

/**
 * Flush buffered records to dataset in batches.
 * @param {boolean} force
 * @returns {Promise<void>}
 */
const flushDataset = async (force = false) => {
    if (!pendingDatasetItems.length) return;
    if (!force && pendingDatasetItems.length < DATASET_FLUSH_SIZE) return;

    const batch = pendingDatasetItems.splice(0, pendingDatasetItems.length);
    await Dataset.pushData(batch);
};

const listCrawler = new CheerioCrawler({
    proxyConfiguration: proxyConf,
    requestHandlerTimeoutSecs: 35,
    navigationTimeoutSecs: 25,
    minConcurrency: 1,
    maxConcurrency: 6,
    useSessionPool: true,
    persistCookiesPerSession: true,
    sessionPoolOptions: {
        maxPoolSize: 12,
        sessionOptions: {
            maxUsageCount: 80,
            maxErrorScore: 3,
        },
    },
    maxRequestRetries: 3,
    retryOnBlocked: true,
    statusMessageLoggingInterval: 999999,
    statisticsOptions: {
        logIntervalSecs: 999999,
    },

    preNavigationHooks: [applyHeaders],

    async requestHandler({ request, $, enqueueLinks, session }) {
        if (isBlockedPage($)) {
            if (session) session.retire();
            throw new Error('Blocked page detected, retrying with a new session.');
        }

        pagesVisited++;
        const localLinks = new Set();
        let linksFoundOnPage = 0;

        const anchorElements = $('a[href*="/jobs/"]').toArray();
        for (const el of anchorElements) {
            if (discoveredDetailRequests.length >= maxJobs) break;

            const href = $(el).attr('href');
            if (!href) continue;
            if (!href.match(/\/jobs\/[^/]+\/[^/]+\/[^/]+\/\d+\/e\/?/)) continue;

            const fullUrl = toAbs(href);
            if (!fullUrl || localLinks.has(fullUrl)) continue;

            localLinks.add(fullUrl);
            linksFoundOnPage++;

            const jobId = extractJobIdFromUrl(fullUrl);
            const uniqueJobKey = jobId || fullUrl;
            if (discoveredJobKeys.has(uniqueJobKey)) continue;

            discoveredJobKeys.add(uniqueJobKey);
            discoveredDetailRequests.push({
                url: fullUrl,
                userData: { jobId },
                uniqueKey: `detail:${uniqueJobKey}`,
            });
        }

        cumulativeLinksFound += linksFoundOnPage;

        log.info(
            `Page ${pagesVisited}: linksFound=${linksFoundOnPage}, discovered=${discoveredDetailRequests.length}, target=${maxJobs}`,
        );

        if (discoveredDetailRequests.length >= maxJobs || pagesVisited >= hardSafetyMaxPages) {
            return;
        }

        const avgLinksPerPage = cumulativeLinksFound / Math.max(1, pagesVisited);
        const autoTargetPages = Math.max(1, Math.ceil(maxJobs / Math.max(1, avgLinksPerPage)));
        const autoMaxPages = Math.min(hardSafetyMaxPages, autoTargetPages + 10);
        if (pagesVisited >= autoMaxPages) return;

        const nextUrl = getNextListUrl($, request.url);
        if (!nextUrl || seenListUrls.has(nextUrl)) return;

        seenListUrls.add(nextUrl);
        await enqueueLinks({
            urls: [nextUrl],
            userData: { label: LIST_LABEL },
            forefront: true,
            transformRequestFunction: (req) => {
                req.uniqueKey = `list:${req.loadedUrl || req.url}`;
                return req;
            },
        });
    },

    failedRequestHandler: async ({ request }, error) => {
        log.warning(`List page failed after retries: ${request.url} | ${error.message}`);
    },
});

const detailCrawler = new CheerioCrawler({
    proxyConfiguration: proxyConf,
    requestHandlerTimeoutSecs: 60,
    navigationTimeoutSecs: 40,
    minConcurrency: 4,
    maxConcurrency: 24,
    useSessionPool: true,
    persistCookiesPerSession: true,
    sessionPoolOptions: {
        maxPoolSize: 24,
        sessionOptions: {
            maxUsageCount: 100,
            maxErrorScore: 3,
        },
    },
    maxRequestRetries: 3,
    retryOnBlocked: true,
    statusMessageLoggingInterval: 999999,
    statisticsOptions: {
        logIntervalSecs: 999999,
    },

    preNavigationHooks: [applyHeaders],

    async requestHandler({ request, $, session }) {
        if (jobsScraped >= maxJobs) return;

        if (isBlockedPage($)) {
            if (session) session.retire();
            throw new Error('Blocked page detected, retrying with a new session.');
        }

        const pageTitle = $('title').text();
        const bodyText = $('body').text();

        let title = cleanText($('h1').first().text());
        if (!title) {
            title = cleanText(pageTitle.split('|')[0] || pageTitle.split('-')[0] || pageTitle);
        }

        const listingForMatch = bodyText.match(/Listing for:\s*([^\n\r]+)/i);
        const company = cleanText(listingForMatch ? listingForMatch[1] : '');

        const locationMatch = bodyText.match(/Job in\s+([^,\n\r]+(?:,\s*[^,\n\r]+)*)/i);
        const extractedLocation = formatLocation(locationMatch ? locationMatch[1] : '');

        const typeMatch = bodyText.match(/\b(Full[\s-]?[Tt]ime|Part[\s-]?[Tt]ime|Contract|Temporary|Permanent|Freelance|Internship|Remote)\b/);
        const jobType = cleanText(typeMatch ? typeMatch[1] : '');

        const datePostedMatch = bodyText.match(/Listed on\s+(\d{4}-\d{2}-\d{2})/i);
        const datePosted = datePostedMatch ? datePostedMatch[1] : '';

        const salaryMatch = bodyText.match(/\$[\d,]+(?:\s*-\s*\$[\d,]+)?(?:\s*(?:per|\/)\s*(?:hour|year|month|annum))?/i);
        const salary = cleanText(salaryMatch ? salaryMatch[0] : '');

        const descriptionNode = $('div[itemprop="description"]').first().length
            ? $('div[itemprop="description"]').first()
            : $('#content_container').first();

        const descriptionHtmlRaw = descriptionNode.length ? descriptionNode.html() || '' : '';
        const descriptionHtml = sanitizeDescriptionHtml(descriptionHtmlRaw);
        const descriptionText = htmlToText(descriptionHtml);

        const jobId = request.userData.jobId || extractJobIdFromUrl(request.url);
        const record = sanitizeRecord({
            title,
            company,
            location: extractedLocation,
            salary,
            job_type: jobType,
            date_posted: datePosted,
            valid_through: $('[itemprop="validThrough"]').attr('content') || '',
            description_html: descriptionHtml,
            description_text: descriptionText,
            url: request.url,
            job_id: jobId,
            search_keyword: keywords[0] || '',
            search_location: cleanText(location),
            source: 'learn4good',
            scraped_at: new Date().toISOString(),
        });

        if (!record.url) {
            detailFailures++;
            return;
        }

        if (record.job_id && seenRecordJobIds.has(record.job_id)) {
            duplicatesSkipped++;
            return;
        }

        if (seenRecordUrls.has(record.url)) {
            duplicatesSkipped++;
            return;
        }

        const fingerprint = buildRecordFingerprint(record);
        if (seenFingerprints.has(fingerprint)) {
            duplicatesSkipped++;
            return;
        }

        if (record.job_id) {
            seenRecordJobIds.add(record.job_id);
        }
        seenRecordUrls.add(record.url);
        seenFingerprints.add(fingerprint);

        pendingDatasetItems.push(record);
        jobsScraped++;

        if (pendingDatasetItems.length >= DATASET_FLUSH_SIZE) {
            await flushDataset();
        }
    },

    failedRequestHandler: async ({ request }, error) => {
        detailFailures++;
        log.warning(`Detail page failed after retries: ${request.url} | ${error.message}`);
    },
});

seenListUrls.add(finalStartUrl);

log.info(`Starting run. maxJobs=${maxJobs}, autoPageLimit=${hardSafetyMaxPages}, phase=list`);
await listCrawler.run([{ url: finalStartUrl, userData: { label: LIST_LABEL }, uniqueKey: `list:${finalStartUrl}` }]);

log.info(`List phase finished. pagesVisited=${pagesVisited}, discovered=${discoveredDetailRequests.length}`);

if (!discoveredDetailRequests.length) {
    log.warning('No job detail URLs discovered. Exiting without dataset writes.');
    await Actor.exit();
} else {
    log.info(`Starting detail phase. requests=${discoveredDetailRequests.length}`);
    await detailCrawler.run(discoveredDetailRequests);
    await flushDataset(true);

    log.info(
        `Run finished. saved=${jobsScraped}, pagesVisited=${pagesVisited}, duplicatesSkipped=${duplicatesSkipped}, failures=${detailFailures}`,
    );

    await Actor.exit();
}
