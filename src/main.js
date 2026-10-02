import { Actor, log } from 'apify';
import * as cheerio from 'cheerio';
import { Impit } from 'impit';

await Actor.init();

const input = (await Actor.getInput()) ?? {};

const SITE_ORIGIN = 'https://www.learn4good.com';
const TRANSLATE_HOST_SUFFIX = '.translate.goog';

const DEFAULT_MAX_JOBS = 20;
const DEFAULT_MAX_PAGES = 25;
const MAX_JOBS_LIMIT = 1000;
const MAX_PAGES_LIMIT = 500;
const DETAIL_CONCURRENCY = 6;
const MAX_REQUEST_RETRIES = 3;
const LIST_REQUEST_TIMEOUT = 35000;
const DETAIL_REQUEST_TIMEOUT = 30000;
const DATASET_FLUSH_SIZE = 25;
const LIST_LABEL = 'LIST';
const DETAIL_LABEL = 'DETAIL';

const cleanText = (value) => {
    if (!value) return '';

    return String(value)
        .replace(/\s+/g, ' ')
        .replace(/^\s*[-•]\s*/, '')
        .trim();
};

const cleanCompany = (value) =>
    cleanText(value)
        .replace(/\s+(?:View this Job|Edit Your Search Specifications).*$/i, '')
        .trim();

const toNonEmptyStrings = (value) => {
    if (value == null) return [];
    if (typeof value === 'string') return cleanText(value) ? [cleanText(value)] : [];
    if (Array.isArray(value)) return value.map((item) => cleanText(item)).filter(Boolean);
    return [];
};

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

const sanitizeDescriptionHtml = (rawHtml) => {
    if (!rawHtml) return '';

    const $ = cheerio.load(`<div id="__desc_root__">${rawHtml}</div>`, { decodeEntities: false });
    const root = $('#__desc_root__');

    root.find(
        'script,style,noscript,iframe,canvas,svg,form,input,button,select,option,nav,header,footer,img,#logo',
    ).remove();
    root.find('a').each((_, element) => {
        $(element).replaceWith($(element).text());
    });

    const allowedTags = new Set(['strong', 'b', 'u', 'em', 'i', 'ul', 'ol', 'li', 'p', 'br']);
    root.find('*').each((_, element) => {
        const tagName = (element.tagName || '').toLowerCase();
        const node = $(element);

        if (!allowedTags.has(tagName)) {
            node.replaceWith(node.contents());
            return;
        }

        for (const attribute of element.attribs ? Object.keys(element.attribs) : []) {
            node.removeAttr(attribute);
        }
    });

    return (root.html() || '')
        .replace(/<br\s*\/?>(\s*<br\s*\/?>){2,}/gi, '<br><br>')
        .replace(/(?:\s|&nbsp;){3,}/g, ' ')
        .trim();
};

const sanitizeRecord = (record) => {
    const output = {};

    for (const [key, value] of Object.entries(record)) {
        if (value == null) continue;

        if (Array.isArray(value)) {
            const cleaned = [...new Set(value.map((item) => cleanText(item)).filter(Boolean))];
            if (cleaned.length) output[key] = cleaned;
            continue;
        }

        if (typeof value === 'object') {
            const nested = sanitizeRecord(value);
            if (Object.keys(nested).length) output[key] = nested;
            continue;
        }

        const cleaned = typeof value === 'string' ? cleanText(value) : value;
        if (cleaned !== '') output[key] = cleaned;
    }

    return output;
};

const isTranslateHost = (hostname) => hostname === 'translate.goog' || hostname.endsWith(TRANSLATE_HOST_SUFFIX);

const toAbs = (href) => {
    if (!href) return null;

    try {
        const url = new URL(href, SITE_ORIGIN);
        if (url.hostname === 'www.learn4good.com' || url.hostname === 'learn4good.com') return url.href;

        if (isTranslateHost(url.hostname)) {
            const direct = new URL(`${SITE_ORIGIN}${url.pathname}`);
            for (const [key, value] of url.searchParams.entries()) {
                if (key.startsWith('_x_tr_')) continue;
                direct.searchParams.set(key, value);
            }
            return direct.href;
        }

        return null;
    } catch {
        return null;
    }
};

const buildGatewayUrl = (url) => {
    const sourceUrl = new URL(url);
    if (isTranslateHost(sourceUrl.hostname)) return sourceUrl.href;

    const translatedHost = `${sourceUrl.hostname.replace(/\./g, '-')}${TRANSLATE_HOST_SUFFIX}`;
    const translatedUrl = new URL(`https://${translatedHost}${sourceUrl.pathname}`);

    for (const [key, value] of sourceUrl.searchParams.entries()) {
        translatedUrl.searchParams.set(key, value);
    }

    translatedUrl.searchParams.set('_x_tr_sl', 'auto');
    translatedUrl.searchParams.set('_x_tr_tl', 'en');
    translatedUrl.searchParams.set('_x_tr_hl', 'en');
    return translatedUrl.href;
};

const getPathname = (url) => {
    try {
        return new URL(url).pathname;
    } catch {
        return '';
    }
};

const isJobDetailUrl = (url) => /^\/jobs\/(?:[^/]+\/)+\d+\/e\/?$/i.test(getPathname(url));

const extractJobIdFromUrl = (url) => {
    const match = getPathname(url).match(/\/(\d+)\/e\/?$/i);
    return match ? match[1] : '';
};

const buildRecordFingerprint = (record) =>
    [
        cleanText(record.title || '').toLowerCase(),
        cleanText(record.company || '').toLowerCase(),
        cleanText(record.location || '').toLowerCase(),
        cleanText(record.date_posted || '').toLowerCase(),
        cleanText(record.description_text || '')
            .toLowerCase()
            .slice(0, 500),
    ].join('|');

const isBlockedResponse = (status, body) => {
    if (status === 403) return true;
    return /Pardon Our Interruption|Just a moment|Access Denied|verifying you are not a robot|cloudflare|ray id:/i.test(
        body,
    );
};

const getNextListUrl = ($, currentUrl) => {
    const selectors = [
        'a[title*="Next"]',
        'a[title*="next"]',
        'a[rel="next"]',
        '.pagination a:contains("Next")',
        '.pagination a:contains("next")',
    ];

    for (const selector of selectors) {
        const href = $(selector).first().attr('href');
        const resolved = toAbs(href);
        if (resolved && !isJobDetailUrl(resolved)) return resolved;
    }

    try {
        const nextUrl = new URL(currentUrl);
        const page = Number.parseInt(nextUrl.searchParams.get('page_number') || '1', 10);
        if (Number.isFinite(page) && page >= 1) {
            nextUrl.searchParams.set('page_number', String(page + 1));
            return nextUrl.href;
        }
    } catch {
        return null;
    }

    return null;
};

const getCard = ($, element) => {
    const card = $(element).closest('td.job_cell, article, .job_result, .job_listing, li').first();
    return card.length ? card : $(element).parent();
};

const extractListItems = (body, listUrl, searchKeyword, searchLocation) => {
    const $ = cheerio.load(body);
    const items = [];
    const localKeys = new Set();

    $('a[href]').each((_, element) => {
        const url = toAbs($(element).attr('href'));
        if (!url || !isJobDetailUrl(url)) return;

        const jobId = extractJobIdFromUrl(url);
        const key = jobId || url;
        if (localKeys.has(key)) return;
        localKeys.add(key);

        const card = getCard($, element);
        const cardText = cleanText(card.text());
        const title = cleanText($(element).find('.job_title, span').first().text() || $(element).text());
        const location = formatLocation(
            card.find('.loc_title').first().text() || card.find('.loc_with_prefix').first().text(),
        );
        const postingDate = cleanText(card.find('.posting_date').first().text());
        const summary = cleanText(card.find('.list_job_desc').first().text());
        const salaryMatch = cardText.match(
            /\$[\d,]+(?:\s*-\s*\$[\d,]+)?(?:\s*(?:per|\/)\s*(?:hour|year|month|annum))?/i,
        );
        const typeMatch = cardText.match(
            /\b(Full[\s-]?time|Part[\s-]?time|Contract|Temporary|Permanent|Freelance|Internship|Remote)\b/i,
        );
        const listingForMatch = cardText.match(/Listing for:\s*([^\n\r]+)/i);

        items.push({
            listUrl,
            detailUrl: url,
            record: sanitizeRecord({
                title,
                company: listingForMatch ? cleanCompany(listingForMatch[1]) : '',
                location,
                salary: salaryMatch ? salaryMatch[0] : '',
                job_type: typeMatch ? typeMatch[1] : '',
                date_posted: postingDate,
                description_text: summary,
                url,
                job_id: jobId,
                search_keyword: searchKeyword,
                search_location: searchLocation,
                source: 'learn4good',
                scraped_at: new Date().toISOString(),
            }),
        });
    });

    return { $, items, nextUrl: getNextListUrl($, listUrl) };
};

const isUsableDetailPage = (body) => {
    if (!body || isBlockedResponse(200, body)) return false;

    const $ = cheerio.load(body);
    const description = $('div[itemprop="description"]').first();
    const title = cleanText($('h1').first().text() || $('title').first().text());
    const descriptionText = cleanText(description.text());

    return Boolean(title && description.length && descriptionText.length >= 20);
};

const parseDetailRecord = (body, candidate) => {
    const $ = cheerio.load(body);
    const pageTitle = $('title').text();
    const bodyText = $('body').text();

    let title = cleanText($('h1').first().text());
    if (!title) title = cleanText(pageTitle.split('|')[0] || pageTitle.split('-')[0] || pageTitle);

    const listingForMatch = bodyText.match(/Listing for:\s*([^\n\r]+)/i);
    const locationMatch = bodyText.match(/Job in\s+([^,\n\r]+(?:,\s*[^,\n\r]+)*)/i);
    const typeMatch = bodyText.match(
        /\b(Full[\s-]?[Tt]ime|Part[\s-]?[Tt]ime|Contract|Temporary|Permanent|Freelance|Internship|Remote)\b/,
    );
    const datePosted =
        $('[itemprop="datePosted"]').attr('content') ||
        (bodyText.match(/Listed on\s+(\d{4}-\d{2}-\d{2})/i) || [])[1] ||
        '';
    const salaryMatch = bodyText.match(/\$[\d,]+(?:\s*-\s*\$[\d,]+)?(?:\s*(?:per|\/)\s*(?:hour|year|month|annum))?/i);
    const descriptionNode = $('div[itemprop="description"]').first().length
        ? $('div[itemprop="description"]').first()
        : $('#content_container').first();
    const descriptionHtml = sanitizeDescriptionHtml(descriptionNode.length ? descriptionNode.html() || '' : '');

    return sanitizeRecord({
        title: title || candidate.record.title,
        company: listingForMatch ? cleanCompany(listingForMatch[1]) : candidate.record.company,
        location: formatLocation(locationMatch ? locationMatch[1] : '') || candidate.record.location,
        salary: salaryMatch ? salaryMatch[0] : candidate.record.salary,
        job_type: typeMatch ? typeMatch[1] : candidate.record.job_type,
        date_posted: datePosted || candidate.record.date_posted,
        valid_through: $('[itemprop="validThrough"]').attr('content') || candidate.record.valid_through,
        description_html: descriptionHtml || candidate.record.description_html,
        description_text: htmlToText(descriptionHtml) || candidate.record.description_text,
        url: candidate.record.url,
        job_id: candidate.record.job_id,
        search_keyword: candidate.record.search_keyword,
        search_location: candidate.record.search_location,
        source: candidate.record.source,
        scraped_at: new Date().toISOString(),
    });
};

const startUrl = toNonEmptyStrings(input.startUrl)[0] || '';

if (!startUrl) {
    throw new Error('INPUT error: provide a Learn4Good jobs URL in `startUrl`.');
}

let searchKeyword = '';
let searchLocation = '';
try {
    const parsedStartUrl = new URL(startUrl);
    searchKeyword = toNonEmptyStrings(parsedStartUrl.searchParams.get('what'))[0] || '';
    searchLocation = toNonEmptyStrings(parsedStartUrl.searchParams.get('where'))[0] || '';
} catch {
    searchKeyword = '';
    searchLocation = '';
}

const maxJobs = Number.isFinite(Number(input.maxJobs))
    ? Math.min(MAX_JOBS_LIMIT, Math.max(1, Math.floor(Number(input.maxJobs))))
    : DEFAULT_MAX_JOBS;
const maxPages = Number.isFinite(Number(input.maxPages))
    ? Math.min(MAX_PAGES_LIMIT, Math.max(1, Math.floor(Number(input.maxPages))))
    : DEFAULT_MAX_PAGES;
const collectDetails = input.collectDetails !== false;

const proxyConfigurationInput = input.proxyConfiguration;
const proxyGroups = proxyConfigurationInput?.apifyProxyGroups ?? proxyConfigurationInput?.groups ?? [];
const customProxyUrls = Array.isArray(proxyConfigurationInput?.proxyUrls)
    ? proxyConfigurationInput.proxyUrls.filter(Boolean)
    : [];
const proxyEnabled = proxyConfigurationInput?.useApifyProxy === true || customProxyUrls.length > 0;

let proxyUrl;
if (proxyEnabled) {
    try {
        const proxyConfigurationObject = await Actor.createProxyConfiguration(proxyConfigurationInput);
        if (proxyConfigurationObject) {
            proxyUrl = await proxyConfigurationObject.newUrl(`learn4good_${Date.now()}`);
        }
        log.info('Proxy enabled for this run');
    } catch (error) {
        log.warning(`Proxy configuration could not be created; continuing without a proxy (${error.message})`);
    }
}

const client = new Impit({
    browser: 'chrome',
    ignoreTlsErrors: proxyGroups.includes('UNBLOCKER'),
    ...(proxyUrl ? { proxyUrl } : {}),
});

const getHeaders = (referer) => ({
    ...(referer ? { Referer: referer } : {}),
});

const wait = (milliseconds) =>
    new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });

const fetchText = async ({
    url,
    headers = {},
    label,
    retries = MAX_REQUEST_RETRIES,
    timeout = LIST_REQUEST_TIMEOUT,
}) => {
    let lastError;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const response = await client.fetch(url, { headers, signal: AbortSignal.timeout(timeout) });
            const text = await response.text();
            const blocked = isBlockedResponse(response.status, text);

            if ((response.status === 429 || response.status >= 500) && attempt < retries) {
                await wait(attempt * 1000);
                continue;
            }

            return { response, body: text, blocked };
        } catch (error) {
            lastError = error;
            if (attempt >= retries) break;
            await wait(attempt * 1000);
        }
    }

    throw lastError ?? new Error(`Request retries exhausted for ${label}.`);
};

let jobsSaved = 0;
let pagesVisited = 0;
let duplicatesSkipped = 0;
let detailFailures = 0;
let detailEnriched = 0;
let listRecoveries = 0;
let stopReason = 'max_jobs';
const discoveredJobKeys = new Set();
const seenRecordUrls = new Set();
const seenRecordJobIds = new Set();
const seenFingerprints = new Set();
const pendingDatasetItems = [];

const flushDataset = async (force = false) => {
    if (!pendingDatasetItems.length || (!force && pendingDatasetItems.length < DATASET_FLUSH_SIZE)) return;
    const batch = pendingDatasetItems.splice(0, pendingDatasetItems.length);
    await Actor.pushData(batch);
};

const addUniqueRecord = (record) => {
    if (!record?.url) return false;
    if (record.job_id && seenRecordJobIds.has(record.job_id)) {
        duplicatesSkipped++;
        return false;
    }
    if (seenRecordUrls.has(record.url)) {
        duplicatesSkipped++;
        return false;
    }

    const fingerprint = buildRecordFingerprint(record);
    if (seenFingerprints.has(fingerprint)) {
        duplicatesSkipped++;
        return false;
    }

    if (record.job_id) seenRecordJobIds.add(record.job_id);
    seenRecordUrls.add(record.url);
    seenFingerprints.add(fingerprint);
    pendingDatasetItems.push(record);
    jobsSaved++;
    return true;
};

const enrichDetails = async (candidates) => {
    if (!collectDetails || !candidates.length) return candidates.map((candidate) => candidate.record);

    const results = new Array(candidates.length);
    let cursor = 0;
    const workerCount = Math.min(DETAIL_CONCURRENCY, candidates.length);

    const worker = async () => {
        while (cursor < candidates.length) {
            const index = cursor++;
            const candidate = candidates[index];
            try {
                const translatedResult = await fetchText({
                    url: buildGatewayUrl(candidate.detailUrl),
                    headers: { Accept: 'text/html' },
                    label: DETAIL_LABEL,
                    timeout: DETAIL_REQUEST_TIMEOUT,
                });

                if (translatedResult.response.ok && isUsableDetailPage(translatedResult.body)) {
                    detailEnriched++;
                    results[index] = parseDetailRecord(translatedResult.body, candidate);
                    continue;
                }
            } catch {
                // keep the list-level record
            }

            detailFailures++;
            results[index] = candidate.record;
        }
    };

    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
};

let currentUrl = startUrl;
let gatewayMode = false;
const seenListUrls = new Set();

log.info(`Starting run. url="${startUrl}" maxJobs=${maxJobs}, maxPages=${maxPages}, collectDetails=${collectDetails}`);

while (pagesVisited < maxPages && jobsSaved < maxJobs) {
    if (seenListUrls.has(currentUrl)) {
        stopReason = 'repeated_page';
        break;
    }
    seenListUrls.add(currentUrl);
    pagesVisited++;

    let listResult;
    try {
        listResult = await fetchText({
            url: gatewayMode ? buildGatewayUrl(currentUrl) : currentUrl,
            headers: gatewayMode ? { Accept: 'text/html' } : getHeaders(SITE_ORIGIN),
            label: LIST_LABEL,
        });
    } catch (error) {
        stopReason = 'list_request_failed';
        log.warning(`List request failed on page ${pagesVisited}: ${error.message}`);
        break;
    }

    let usable = !listResult.blocked && listResult.response.ok;
    let parsed = usable ? extractListItems(listResult.body, currentUrl, searchKeyword, searchLocation) : null;

    if (!gatewayMode && (!usable || !parsed || parsed.items.length <= 1)) {
        try {
            const gatewayResult = await fetchText({
                url: buildGatewayUrl(currentUrl),
                headers: { Accept: 'text/html' },
                label: LIST_LABEL,
            });
            if (gatewayResult.response.ok && !gatewayResult.blocked) {
                gatewayMode = true;
                listRecoveries++;
                listResult = gatewayResult;
                parsed = extractListItems(gatewayResult.body, currentUrl, searchKeyword, searchLocation);
                usable = true;
                log.warning('Direct request was blocked; continuing through the translation gateway');
            }
        } catch {
            // fall through to the failure handling below
        }
    }

    if (!usable || !parsed) {
        stopReason = listResult.blocked ? 'list_blocked' : `list_http_${listResult.response.status}`;
        log.warning(`List page ${pagesVisited} was not usable: HTTP ${listResult.response.status}`);
        break;
    }

    if (!parsed.items.length) {
        stopReason = 'no_results';
        break;
    }

    const candidates = [];
    for (const item of parsed.items) {
        const key = item.record.job_id || item.detailUrl;
        if (discoveredJobKeys.has(key)) continue;
        discoveredJobKeys.add(key);
        candidates.push(item);
        if (candidates.length >= maxJobs - jobsSaved) break;
    }

    if (!candidates.length) {
        stopReason = 'no_new_results';
        break;
    }

    const records = await enrichDetails(candidates);
    for (const record of records) {
        if (jobsSaved >= maxJobs) break;
        addUniqueRecord(record);
    }
    await flushDataset();

    log.debug(`Page ${pagesVisited}: new=${candidates.length}, saved=${jobsSaved}`);

    if (jobsSaved >= maxJobs) {
        stopReason = 'max_jobs';
        break;
    }

    const candidateNextUrl = parsed.nextUrl || getNextListUrl(parsed.$, currentUrl);
    if (!candidateNextUrl || seenListUrls.has(candidateNextUrl)) {
        stopReason = candidateNextUrl ? 'repeated_page' : 'no_next_page';
        break;
    }
    currentUrl = candidateNextUrl;
}

await flushDataset(true);
if (pagesVisited >= maxPages && jobsSaved < maxJobs) stopReason = 'max_pages';

log.info(
    `Run finished. saved=${jobsSaved}, pagesVisited=${pagesVisited}, duplicatesSkipped=${duplicatesSkipped}, detailEnriched=${detailEnriched}, detailFailures=${detailFailures}, listRecoveries=${listRecoveries}, source=${gatewayMode ? 'gateway' : 'direct'}, stop_reason=${stopReason}`,
);

await Actor.exit();
