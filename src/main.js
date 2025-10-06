
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

const htmlToText = (html) => {
    if (!html) return '';
    
    return html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // Remove scripts
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')   // Remove styles
        .replace(/<br\s*\/?>/gi, '\n')                    // BR to newline
        .replace(/<\/(p|div|li|h\d|tr)>/gi, '\n')        // Block elements to newline
        .replace(/<[^>]+>/g, '')                          // Remove all HTML tags
        .replace(/&nbsp;/gi, ' ')                         // Convert &nbsp; to space
        .replace(/&amp;/gi, '&')                          // Convert &amp; to &
        .replace(/&lt;/gi, '<')                           // Convert &lt; to <
        .replace(/&gt;/gi, '>')                           // Convert &gt; to >
        .replace(/&quot;/gi, '"')                         // Convert &quot; to "
        .replace(/&#\d+;/g, '')                           // Remove numeric entities
        .replace(/\n\s*\n/g, '\n')                        // Multiple newlines to single
        .replace(/\s{2,}/g, ' ')                          // Multiple spaces to single
        .trim();
};

const cleanText = (text) => {
    if (!text) return 'N/A';
    
    return text
        .replace(/\s+/g, ' ')                             // Multiple spaces to single
        .replace(/^\s*[-•]\s*/, '')                       // Remove leading bullets
        .replace(/\n+/g, ' ')                             // Newlines to spaces
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
            
            // Learn4Good specific job link patterns - be more precise
            const excludePatterns = [
                '/register', '/registration', '/login', '/site-login', '/enter.htm',
                '/faqs', '/employer', '/search/advanced', '/jobseeker_faqs', '/employer_faqs',
                '/language/english/registration', '/jobs/language/english/registration',
                'post-jobs', 'apply-for-jobs', 'job-search-engine'
            ];
            
            // First, try to find job links in structured data (tables, lists)
            $('table tr, ul li, ol li').each((_, row) => {
                const $row = $(row);
                const rowText = $row.text().toLowerCase();
                
                // Check if this row contains job-like information
                if (rowText.includes('salary') || rowText.includes('location') || 
                    rowText.includes('company') || rowText.includes('apply') ||
                    (rowText.includes('job') && (rowText.includes('title') || rowText.includes('position')))) {
                    
                    $row.find('a').each((_, el) => {
                        const href = $(el).attr('href');
                        const linkText = cleanText($(el).text());
                        
                        if (href && linkText !== 'N/A' && linkText.length > 5) {
                            const fullUrl = toAbs(href);
                            const isExcluded = excludePatterns.some(pattern => href.toLowerCase().includes(pattern));
                            
                            if (!isExcluded && fullUrl && !jobLinks.includes(fullUrl)) {
                                // Additional validation - check if link text looks like a job title
                                const hasJobKeywords = /\b(manager|engineer|developer|analyst|specialist|coordinator|assistant|director|officer|consultant|technician|supervisor|representative|associate|administrator)\b/i.test(linkText);
                                const isNotNavigation = !/(register|login|search|faq|post|apply now|click here|more info)/i.test(linkText);
                                
                                if (hasJobKeywords || (linkText.length > 15 && isNotNavigation)) {
                                    jobLinks.push(fullUrl);
                                    crawlerLog.info(`Found job: "${linkText}" -> ${href}`);
                                }
                            }
                        }
                    });
                }
            });
            
            // If no structured jobs found, look for any reasonable job links
            if (jobLinks.length === 0) {
                crawlerLog.info('No structured jobs found, trying general search...');
                
                $('a').each((_, el) => {
                    const href = $(el).attr('href');
                    const linkText = cleanText($(el).text());
                    
                    if (href && linkText !== 'N/A' && linkText.length > 20) { // Longer text more likely to be job title
                        const fullUrl = toAbs(href);
                        const isExcluded = excludePatterns.some(pattern => href.toLowerCase().includes(pattern));
                        const isNotCountryList = !/(albania|algeria|andorra|angola|argentina|australia|austria|bahrain|bangladesh|belgium|brazil|canada|china|denmark|egypt|france|germany|india|italy|japan|korea|malaysia|mexico|netherlands|norway|pakistan|poland|portugal|russia|singapore|spain|sweden|switzerland|thailand|ukraine|vietnam)/i.test(linkText);
                        
                        if (!isExcluded && isNotCountryList && fullUrl && !jobLinks.includes(fullUrl)) {
                            jobLinks.push(fullUrl);
                            crawlerLog.info(`Found potential job: "${linkText.substring(0, 50)}..." -> ${href}`);
                        }
                    }
                });
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
                    // Find the job element containing this link
                    let jobElement = $(`a[href="${jobLink}"]`).first();
                    if (jobElement.length === 0) {
                        const linkPart = jobLink.split('/').pop();
                        jobElement = $(`a[href*="${linkPart}"]`).first();
                    }
                    
                    if (jobElement.length === 0) {
                        crawlerLog.warning(`Could not find element for job link: ${jobLink}`);
                        continue;
                    }
                    
                    // Get the job title from the link text
                    let title = cleanText(jobElement.text());
                    
                    // Find the container (table row, list item, or div)
                    let container = jobElement.closest('tr, li, div');
                    if (container.length === 0) {
                        container = jobElement.parent();
                    }
                    
                    let company = 'N/A';
                    let location = 'N/A';
                    let salary = 'N/A';
                    
                    // For table rows (most common Learn4Good pattern)
                    if (container.is('tr')) {
                        const cells = container.find('td');
                        crawlerLog.info(`Found ${cells.length} cells in row`);
                        
                        // Log cell contents for debugging
                        cells.each((i, cell) => {
                            const cellText = cleanText($(cell).text());
                            crawlerLog.info(`Cell ${i}: "${cellText}"`);
                        });
                        
                        // Extract data based on typical Learn4Good table structure
                        if (cells.length >= 2) {
                            // Usually: Title | Company/Details | Location/Salary
                            for (let i = 1; i < cells.length; i++) {
                                const cellText = cleanText($(cells[i]).text());
                                
                                // Check if this cell contains company info
                                if (company === 'N/A' && cellText.length > 2 && 
                                    !cellText.match(/^\$|\d+k|\d+,\d+|per hour|hourly|annual/i)) {
                                    company = cellText;
                                }
                                
                                // Check if this cell contains location info
                                if (location === 'N/A' && cellText.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:,\s*[A-Z]{2,})?/)) {
                                    location = cellText;
                                }
                                
                                // Check if this cell contains salary info
                                if (salary === 'N/A' && cellText.match(/\$|\d+k|\d+,\d+|per hour|hourly|annual/i)) {
                                    salary = cellText;
                                }
                            }
                        }
                    } else {
                        // For non-table structures, look for specific classes or patterns
                        const allText = container.text();
                        const textParts = allText.split(/[|\n-]/);
                        
                        textParts.forEach(part => {
                            const cleanPart = cleanText(part);
                            if (cleanPart.length > 2) {
                                if (company === 'N/A' && !cleanPart.match(/\$|\d+k|per hour/i)) {
                                    company = cleanPart;
                                } else if (location === 'N/A') {
                                    location = cleanPart;
                                }
                            }
                        });
                    }
                    
                    const item = {
                        title: title,
                        company: company,
                        location: location,
                        salary: salary !== 'N/A' ? salary : undefined,
                        date_posted: null,
                        description_html: '',
                        description_text: '',
                        url: jobLink,
                    };

                    await Dataset.pushData(item);
                    jobsScraped++;
                    crawlerLog.info(`✓ Job ${jobsScraped}/${MAX_JOBS}: "${title}" at "${company}" in "${location}"`);
                    
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

            crawlerLog.info(`Processing detail page: ${request.url}`);

            // Extract job title with better cleaning
            let title = cleanText(
                $('h1[itemprop="title"]').text() || 
                $('h1').first().text() || 
                $('.job-title, .jobtitle').first().text() ||
                $('title').text().split('|')[0] ||
                $('title').text().split('-')[0]
            );

            // Extract company name with better cleaning
            let company = cleanText(
                $('span[itemprop="name"]').text() || 
                $('.company-name, .employer, .company').first().text() ||
                $('strong:contains("Company"), b:contains("Company")').parent().text().replace(/Company:?\s*/i, '') ||
                $('td:contains("Company:"), td:contains("Employer:")').next().text()
            );

            // Extract location with better cleaning
            let location = cleanText(
                $('span[itemprop="addressLocality"]').text() || 
                $('.location, .job-location, .city').first().text() ||
                $('strong:contains("Location"), b:contains("Location")').parent().text().replace(/Location:?\s*/i, '') ||
                $('td:contains("Location:"), td:contains("City:")').next().text()
            );

            // Extract salary if available
            let salary = cleanText(
                $('.salary, .pay, .wage').first().text() ||
                $('strong:contains("Salary"), b:contains("Salary")').parent().text().replace(/Salary:?\s*/i, '') ||
                $('td:contains("Salary:"), td:contains("Pay:")').next().text()
            );
            if (salary === 'N/A') salary = undefined;

            // Extract posted date
            let date_posted = cleanText(
                $('meta[itemprop="datePosted"]').attr('content') || 
                $('.date-posted, .job-date, .posted').first().text() ||
                $('strong:contains("Posted"), b:contains("Posted")').parent().text().replace(/Posted:?\s*/i, '') ||
                $('td:contains("Posted:"), td:contains("Date:")').next().text()
            );
            if (date_posted === 'N/A') date_posted = null;

            // Extract job description with better targeting
            let descriptionContainer = null;
            let description_html = '';
            let description_text = '';

            // Try structured data first
            if ($('div[itemprop="description"]').length > 0) {
                descriptionContainer = $('div[itemprop="description"]');
            }
            // Try common job description classes
            else if ($('.job-description, .description, .job-content, .jobdescription').length > 0) {
                descriptionContainer = $('.job-description, .description, .job-content, .jobdescription').first();
            }
            // Look for main content that's not navigation
            else {
                // Find the element with the most text that's not navigation
                let bestElement = null;
                let maxLength = 0;
                
                $('div, section, article').each((_, el) => {
                    const $el = $(el);
                    const text = $el.text().trim();
                    const isNavigation = $el.find('a').length > text.length / 50; // Too many links = navigation
                    
                    if (!isNavigation && text.length > maxLength && text.length > 200) {
                        maxLength = text.length;
                        bestElement = $el;
                    }
                });
                
                if (bestElement) {
                    descriptionContainer = bestElement;
                }
            }

            if (descriptionContainer && descriptionContainer.length > 0) {
                // Clean the HTML before converting to text
                const cleanedContainer = descriptionContainer.clone();
                cleanedContainer.find('script, style, nav, .navigation, .menu, header, footer').remove();
                cleanedContainer.find('a').each((_, el) => {
                    const $el = $(el);
                    if ($el.text().length < 5) $el.remove(); // Remove short navigation links
                });
                
                description_html = cleanedContainer.html() || '';
                description_text = htmlToText(description_html);
            }

            const item = {
                title,
                company,
                location,
                salary,
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

log.info('Starting scraper...');
log.info(`Configuration: MAX_JOBS=${MAX_JOBS}, MAX_PAGES=${MAX_PAGES}, collectDetails=${collectDetails}`);
log.info(`Input - startUrl: ${startUrl || 'Not provided'}, keyword: ${keyword || 'Not provided'}, location: ${location || 'Not provided'}`);
log.info(`Final Start URL: ${finalStartUrl}`);

await crawler.run([finalStartUrl]);
log.info(`✓ Scraping completed. Total jobs scraped: ${jobsScraped}, Pages visited: ${pagesVisited}`);

await Actor.exit();
