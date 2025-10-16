// Learn4Good.com jobs scraper (CheerioCrawler) - FIXED VERSION
import { Actor, log } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';
import * as cheerio from 'cheerio';

await Actor.init();

// ------------------------- INPUT -------------------------
const input = await Actor.getInput() ?? {};
const {
    startUrl = '',
    keyword = 'nurse',  // Default keyword for empty input
    location = '',
    posted_date = 'anytime',
    collectDetails = true,
    maxJobs: MAX_JOBS_RAW = 50,  // Default max jobs (low for Apify QA tests)
    maxPages: MAX_PAGES_RAW = 5,  // Default max pages (low for Apify QA tests)
    cookies = '',
    proxyConfiguration,
} = input;

// ------------------------- INPUT NORMALIZATION & VALIDATION -------------------------
// Small helpers that normalize user input without changing downstream logic
const toNonEmptyStrings = (value) => {
    if (value == null) return [];
    // If it's a single string, split to array of one
    if (typeof value === 'string') {
        const v = value.trim();
        return v ? [v] : [];
    }
    // If it's an array, map/trim and filter
    if (Array.isArray(value)) {
        return value
            .filter((it) => it != null)
            .map((it) => String(it).trim())
            .filter((it) => it.length > 0);
    }
    // Other types are ignored
    return [];
};

const hasUseful = (arr) => Array.isArray(arr) && arr.length > 0;

// Prefer explicit singular keys, fall back to plural keys
const startUrls = toNonEmptyStrings(input.startUrl ?? input.startUrls ?? startUrl);
const keywords = toNonEmptyStrings(input.keyword ?? input.keywords ?? keyword);

// Only throw if both normalized lists are empty
if (!hasUseful(startUrls) && !hasUseful(keywords)) {
    throw new Error('INPUT error: Either "startUrl" or "keyword" field is required.');
}

const MAX_JOBS = Number.isFinite(+MAX_JOBS_RAW) ? Math.max(1, +MAX_JOBS_RAW) : Number.MAX_SAFE_INTEGER;
const MAX_PAGES = Number.isFinite(+MAX_PAGES_RAW) ? Math.max(1, +MAX_PAGES_RAW) : Number.MAX_SAFE_INTEGER;

// Debug logging to verify input values
log.info(`[DEBUG] Input received - maxJobs: ${input.maxJobs}, maxPages: ${input.maxPages}`);
log.info(`[DEBUG] After destructuring - MAX_JOBS_RAW: ${MAX_JOBS_RAW}, MAX_PAGES_RAW: ${MAX_PAGES_RAW}`);
log.info(`[DEBUG] Final values - MAX_JOBS: ${MAX_JOBS}, MAX_PAGES: ${MAX_PAGES}`);

// ------------------------- HELPERS -------------------------
const buildStartUrl = (kw, loc, date) => {
    // Learn4Good uses PHP-style query parameters for search
    const baseUrl = 'https://www.learn4good.com/jobs/index.php';
    const params = new URLSearchParams();
    
    params.set('controller', 'job_list');
    params.set('action', 'display_search_results');
    params.set('page_number', '1');
    
    if (kw) {
        params.set('what', kw.trim());
    }
    
    if (loc) {
        params.set('where', loc.trim());
    }
    
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
        .replace(/<\/(p|div|li|h\d|tr|td)>/gi, '\n')
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

const formatLocation = (locationString) => {
    if (!locationString || locationString === 'N/A') return 'N/A';
    
    // Split the location by commas and clean each part
    const parts = locationString.split(',').map(part => part.trim()).filter(part => part);
    
    if (parts.length === 0) return 'N/A';
    
    // Get the first part (city) and last part (country)
    const firstPart = parts[0];
    const lastPart = parts[parts.length - 1];
    
    // If the first part starts with numbers or looks like a ZIP/postal code, only return the country
    if (/^\d/.test(firstPart) || /^\d{5}(-\d{4})?$/.test(firstPart) || /^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/.test(firstPart)) {
        return lastPart;
    }
    
    // If we have only one part, return it
    if (parts.length === 1) {
        return firstPart;
    }
    
    // Return "City, Country" format
    return `${firstPart}, ${lastPart}`;
};

// ------------------------- IMPROVED DESCRIPTION CLEANER (DOM-based) -------------------------
const cleanDescription = (html) => {
    if (!html) return { html: '', text: '' };

    const $ = cheerio.load(html);

    // Remove specific Learn4Good navigation and metadata elements
    const removeSelectors = [
        'script', 'style', 'nav', 'header', 'footer', 'form', 'iframe',
        'noscript', 'svg', 'canvas', 'button', 'input', 'select', 'option', 'label',
        // Learn4Good specific elements
        '#top_section', '#mob_ad_container', '.path', '.no_heading_path',
        '#info_div', '.ll', '#by_line', '.bottom_main_info',
        '#logo', // <-- ** FIX: Added selector to remove the company logo div **
        '[id*="ad"]', '[class*="ad"]', '[class*="banner"]',
        // Generic cleanup
        '.cookie', '#cookie', '[id*="cookie"]', '[class*="cookie"]',
        '.ads', '.advertisement', '.banner', '.social', '.share', '.share-buttons',
        '.search', '.filter', '.job-search', '.cv-search', '.navigation', '.menu',
        '.sidebar', '.related-jobs', '.similar-jobs', '.breadcrumb',
        // Metadata elements
        'meta', '[itemprop]', '[itemscope]', '[itemtype]'
    ];
    $(removeSelectors.join(',')).remove();

    // Remove elements with too many links (navigation)
    $('div, section, article').each((_, el) => {
        const $el = $(el);
        const linkCount = $el.find('a').length;
        const textLength = $el.text().trim().length;
        
        // If more than 50% links, it's probably navigation
        if (linkCount > 5 && linkCount > textLength / 20) {
            $el.remove();
        }
    });

    // Remove superfluous tiny elements
    $('div, section, aside, article, span, li, p').each((_, el) => {
        const txt = $(el).text().trim();
        if (txt.length < 40 && $(el).children().length === 0) {
            $(el).remove();
        }
    });

    // Remove wrappers with too many attributes (widgets)
    $('div, section, article').each((_, el) => {
        const attrCount = Object.keys(el.attribs || {}).length;
        if (attrCount > 10 && $(el).find('input,select,button,form').length > 0) {
            $(el).remove();
        }
    });

    const cleanedHtml = $('body').html() || '';
    const text = htmlToText(cleanedHtml);

    // Filter cookie/privacy/menu lines from text
    const lines = text.split('\n').filter((line) => {
        const lower = line.toLowerCase().trim();
        return (
            lower.length > 15 &&
            !lower.includes('cookie') &&
            !lower.includes('privacy policy') &&
            !lower.includes('manage settings') &&
            !lower.includes('accept & continue') &&
            !lower.includes('opt-out') &&
            !lower.match(/^(home|jobs|search|login|register|apply now|view|click|back to)$/i)
        );
    });

    return { html: cleanedHtml.trim(), text: lines.join('\n\n').trim() };
};

// ------------------------- START URLS -------------------------
// Use normalized values: pick first startUrl if available, else build from first keyword
const finalStartUrl = hasUseful(startUrls) 
    ? startUrls[0] 
    : buildStartUrl(keywords[0] || '', location, posted_date);

// ------------------------- PROXY -------------------------
const proxyConf = proxyConfiguration
    ? await Actor.createProxyConfiguration(proxyConfiguration)
    : undefined;

// ------------------------- SHARED STATE -------------------------
let jobsScraped = 0;
let pagesVisited = 0;
const processedUrls = new Set();

// ------------------------- CRAWLER -------------------------
const crawler = new CheerioCrawler({
    proxyConfiguration: proxyConf,

    // ⚡ Faster but safe (was 30 RPM / 2 conc.) -> bump throughput
    maxRequestsPerMinute: 120,
    requestHandlerTimeoutSecs: 60,
    navigationTimeoutSecs: 45,
    maxConcurrency: 10,

    useSessionPool: true,
    persistCookiesPerSession: true,
    sessionPoolOptions: {
        maxPoolSize: 20,
        sessionOptions: {
            maxUsageCount: 100,
            maxErrorScore: 3,
        },
    },
    maxRequestRetries: 5,
    
    // Add retry delay
    retryOnBlocked: true,

    preNavigationHooks: [
        ({ request, session }) => {
            // Rotate user agents
            const userAgents = [
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15'
            ];
            
            const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];
            
            request.headers = {
                'User-Agent': randomUA,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'DNT': '1',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'same-origin',
                'Sec-Fetch-User': '?1',
                'Cache-Control': 'max-age=0',
                'Referer': 'https://www.learn4good.com/',
            };
            
            if (cookies) {
                request.headers['Cookie'] = cookies;
            }
            
            // Keep session metadata as-is
            if (session) {
                session.userData = session.userData || {};
                session.userData.lastRequestTime = Date.now();
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
            title.includes('Access Denied') ||
            bodyText.includes('Verifying you are not a robot') ||
            bodyText.includes('Cloudflare') ||
            bodyText.includes('Ray ID:')) {
            
            crawlerLog.warning(`Detected blocking page on ${request.url}. Retiring session and retrying.`);
            if (session) {
                session.retire();
            }
            throw new Error(`Blocked - will retry with new session`);
        }

        if (label === 'LIST') {
            pagesVisited++;
            crawlerLog.info(`Processing LIST page ${pagesVisited}/${MAX_PAGES}: ${request.url}`);
            
            const jobLinks = [];
            
            // Learn4Good wraps each job in a specific structure
            $('a').each((_, el) => {
                const href = $(el).attr('href');
                if (!href) return;
                
                // Match job detail URLs
                if (href.match(/\/jobs\/[^\/]+\/[^\/]+\/[^\/]+\/\d+\/e\/?/)) {
                    const fullUrl = toAbs(href);
                    if (fullUrl && !jobLinks.includes(fullUrl) && !processedUrls.has(fullUrl)) {
                        const linkText = cleanText($(el).text());
                        if (linkText !== 'N/A' && linkText.length > 3) {
                            jobLinks.push(fullUrl);
                            processedUrls.add(fullUrl);
                        }
                    }
                }
            });

            crawlerLog.info(`Found ${jobLinks.length} new job links on page ${pagesVisited}`);

            if (jobLinks.length === 0) {
                crawlerLog.warning('No jobs found. May have reached end of results or been blocked.');
                // Don't stop immediately - try next page
            }

            const remainingSlots = MAX_JOBS - jobsScraped;
            const linksToEnqueue = jobLinks.slice(0, Math.max(0, remainingSlots));

            crawlerLog.info(`[QUEUE] jobsScraped: ${jobsScraped}, MAX_JOBS: ${MAX_JOBS}, remainingSlots: ${remainingSlots}, will enqueue: ${linksToEnqueue.length}`);

            if (collectDetails && linksToEnqueue.length > 0) {
                // (⬇️ removed the artificial 100ms per-link delay to speed things up)
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
                    
                    const container = linkElement.closest('div, article, section, li');
                    const containerText = container.text();
                    
                    let company = 'N/A';
                    const companyMatch = containerText.match(/Listing for:\s*([^\n]+)/);
                    if (companyMatch) {
                        company = cleanText(companyMatch[1]);
                    }
                    
                    let location = 'N/A';
                    const locationMatch = containerText.match(/Job in\s+([^,\n]+(?:,\s*[^,\n]+)*)/);
                    if (locationMatch) {
                        location = formatLocation(cleanText(locationMatch[1]));
                    }
                    
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

            // Pagination - Continue as long as we haven't hit limits
            if (jobsScraped < MAX_JOBS && pagesVisited < MAX_PAGES) {
                let nextUrl = null;
                
                try {
                    // Method 1: Look for actual "Next" links on the page
                    const nextSelectors = [
                        'a:contains("Next")', 'a:contains("next")', 'a:contains(">")',
                        'a[title*="Next"]', 'a[title*="next"]', '.next a',
                        '.pagination a:last', 'a[href*="page"]'
                    ];
                    
                    for (const selector of nextSelectors) {
                        const link = $(selector).attr('href');
                        if (link && !link.includes('javascript')) {
                            nextUrl = toAbs(link);
                            crawlerLog.info(`Found next page with selector: ${selector} -> ${nextUrl}`);
                            break;
                        }
                    }
                    
                    // Method 2: Try different parameter patterns if no next link found
                    if (!nextUrl) {
                        const currentUrl = new URL(request.url);
                        
                        // Try different pagination parameter patterns
                        const patterns = [
                            'page_number', 'page', 'p', 'start', 'offset'
                        ];
                        
                        for (const param of patterns) {
                            const currentPage = parseInt(currentUrl.searchParams.get(param) || '1');
                            if (currentPage < 50) { // Safety limit
                                const testUrl = new URL(currentUrl);
                                testUrl.searchParams.set(param, (currentPage + 1).toString());
                                nextUrl = testUrl.href;
                                crawlerLog.info(`Constructed next page using ${param}: ${nextUrl}`);
                                break;
                            }
                        }
                    }
                    
                    // Method 3: If still no URL and it's the first few pages, try appending page number
                    if (!nextUrl && pagesVisited <= 5) {
                        const baseUrl = request.url.split('?')[0];
                        if (!baseUrl.includes('page')) {
                            nextUrl = `${baseUrl}?page=${pagesVisited + 1}`;
                            crawlerLog.info(`Constructed simple page URL: ${nextUrl}`);
                        }
                    }
                    
                    if (nextUrl) {
                        await enqueueLinks({
                            urls: [nextUrl],
                            userData: { label: 'LIST' },
                        });
                        crawlerLog.info(`Enqueued next page (${pagesVisited + 1}): ${nextUrl}`);
                    } else {
                        crawlerLog.info('No more pages to try - ending pagination');
                    }
                    
                } catch (e) {
                    crawlerLog.warning(`Pagination error: ${e.message}`);
                }
            } else if (pagesVisited >= MAX_PAGES) {
                crawlerLog.info(`Reached maximum pages limit (${MAX_PAGES}). Stopping.`);
            } else if (jobsScraped >= MAX_JOBS) {
                crawlerLog.info(`Reached job limit (${jobsScraped}/${MAX_JOBS}). Stopping.`);
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

            // Extract company
            let company = 'N/A';
            $('*').each((_, el) => {
                const text = $(el).text();
                if (text.includes('Listing for:')) {
                    const match = text.match(/Listing for:\s*([^\n]+)/);
                    if (match) {
                        company = cleanText(match[1]);
                        return false;
                    }
                }
            });

            // Extract location
            let location = 'N/A';
            $('*').each((_, el) => {
                const text = $(el).text();
                if (text.includes('Job in')) {
                    const match = text.match(/Job in\s+([^,\n]+(?:,\s*[^,\n]+)*)/);
                    if (match) {
                        location = formatLocation(cleanText(match[1]));
                        return false;
                    }
                }
            });

            // Extract job type
            let job_type = undefined;
            const bodyText = $('body').text();
            const typeMatch = bodyText.match(/\b(Full[\s-]?[Tt]ime|Part[\s-]?[Tt]ime|Contract|Temporary|Permanent|Freelance|Internship|Remote)\b/);
            if (typeMatch) {
                job_type = cleanText(typeMatch[1]);
            }

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

            // Extract date posted
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

            // Extract salary
            let salary = undefined;
            const salaryMatch = bodyText.match(/\$[\d,]+(?:\s*-\s*\$[\d,]+)?(?:\s*(?:per|\/)\s*(?:hour|year|month|annum))?/i);
            if (salaryMatch) {
                salary = cleanText(salaryMatch[0]);
            }

            // Extract job description - IMPROVED
            let description_html = '';
            let description_text = '';

            // Try structured data first (Learn4Good uses itemprop="description")
            let descriptionElement = $('div[itemprop="description"]');
            
            if (descriptionElement.length === 0) {
                // Find main content by looking for job description keywords
                let bestContent = null;
                let maxScore = 0;

                $('div, section, article').each((_, el) => {
                    const $el = $(el);
                    const elId = $el.attr('id') || '';
                    const elClass = $el.attr('class') || '';
                    
                    // Skip navigation, header, and metadata elements
                    if (elId.includes('top_section') || elId.includes('info_div') || 
                        elId.includes('mob_ad') || elClass.includes('path') ||
                        elId.includes('cookie') || elClass.includes('cookie') ||
                        elId.includes('nav') || elClass.includes('nav') ||
                        elId.includes('menu') || elClass.includes('menu') ||
                        elClass.includes('ll') || elClass.includes('by_line')) {
                        return;
                    }
                    
                    const linkCount = $el.find('a').length;
                    const textLength = $el.text().trim().length;
                    const linkDensity = linkCount / Math.max(textLength / 100, 1);
                    
                    // Skip if too many links (navigation) or too short
                    if (linkDensity > 5 || textLength < 200) {
                        return;
                    }
                    
                    const text = $el.text().toLowerCase();
                    
                    // Score based on job description keywords
                    let score = 0;
                    if (text.includes('responsibilities')) score += 5;
                    if (text.includes('requirements')) score += 5;
                    if (text.includes('qualifications')) score += 4;
                    if (text.includes('job description')) score += 4;
                    if (text.includes('role description')) score += 4;
                    if (text.includes('what you')) score += 3;
                    if (text.includes('experience')) score += 2;
                    if (text.includes('skills')) score += 2;
                    if (text.includes('education')) score += 1;
                    
                    // Bonus for longer text
                    score += Math.min(textLength / 1000, 3);
                    
                    // Penalty for too many links
                    score -= linkDensity;
                    
                    if (score > maxScore && score > 2) {
                        maxScore = score;
                        bestContent = $el;
                    }
                });
                
                descriptionElement = bestContent;
            }

            if (descriptionElement && descriptionElement.length > 0) {
                const rawHtml = descriptionElement.html() || '';
                const cleaned = cleanDescription(rawHtml);
                description_html = cleaned.html;
                description_text = cleaned.text;
                
                crawlerLog.info(`Description extracted from element with score: ${description_text.length} chars`);
            } else {
                crawlerLog.warning('No suitable description element found');
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
        log.error(`Request ${request.url} failed after retries: ${error.message}`);
    },
});

log.info('Starting Learn4Good scraper...');
log.info(`Configuration: MAX_JOBS=${MAX_JOBS}, MAX_PAGES=${MAX_PAGES}, collectDetails=${collectDetails}`);
log.info(`Search params - keyword: ${keywords[0] || 'N/A'}, location: ${location || 'N/A'}, posted_date: ${posted_date}`);
log.info(`Final Start URL: ${finalStartUrl}`);

await crawler.run([finalStartUrl]);
log.info(`✓ Scraping completed. Jobs scraped: ${jobsScraped}, Pages visited: ${pagesVisited}`);

await Actor.exit();