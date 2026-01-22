# Learn4Good Jobs Scraper

Extract comprehensive job listings from Learn4Good with ease. Collect job titles, companies, locations, posting dates, and detailed descriptions at scale. Perfect for recruitment research, job market analysis, and employment data monitoring.

## Features

- **Comprehensive Data Extraction** — Capture complete job information including titles, companies, locations, and full descriptions
- **Flexible Search Options** — Search by keywords, locations, or use direct Learn4Good URLs
- **Smart Pagination** — Automatically navigate through multiple pages to reach your desired result count
- **Date Filtering** — Filter jobs by posting date (24 hours, 7 days, 30 days, or anytime)
- **Detailed Job Descriptions** — Optionally extract full job descriptions from individual posting pages
- **Configurable Limits** — Control data volume with customizable job and page limits
- **Reliable Data Collection** — Built-in proxy support ensures consistent scraping performance

## Use Cases

### Recruitment Intelligence
Build comprehensive job databases for recruitment agencies and talent acquisition teams. Track new openings across multiple locations and industries to identify hiring trends and opportunities.

### Job Market Research
Analyze employment trends, salary patterns, and skill requirements across different regions. Gather data for market reports, competitive analysis, and workforce planning.

### Career Planning
Monitor job availability in specific fields or locations. Help job seekers identify opportunities, understand market demand, and track hiring patterns over time.

### Competitive Analysis
Track competitor hiring activities and expansion plans. Identify growing companies and emerging job markets by monitoring posting frequency and job types.

### Academic Research
Collect employment data for labor market studies, economic research, and workforce development analysis. Build datasets for statistical analysis and trend identification.

---

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `startUrl` | String | No | — | Direct Learn4Good search URL (overrides keyword/location when provided) |
| `keyword` | String | No | `"nurse"` | Search term for job listings |
| `location` | String | No | `"New York"` | Location filter for job search |
| `posted_date` | String | No | `"anytime"` | Filter by posting date: `24h`, `7d`, `30d`, or `anytime` |
| `collectDetails` | Boolean | No | `true` | Extract full job descriptions from detail pages |
| `maxJobs` | Integer | No | `200` | Maximum number of jobs to collect |
| `maxPages` | Integer | No | `25` | Maximum number of listing pages to crawl |
| `cookies` | String | No | — | Optional custom cookie header for requests |
| `proxyConfiguration` | Object | No | Datacenter | Custom proxy settings (uses Apify datacenter proxies by default) |

---

## Output Data

Each job listing in the dataset contains:

| Field | Type | Description |
|-------|------|-------------|
| `title` | String | Job title or position name |
| `company` | String | Employer or company name |
| `location` | String | Job location (city, state, or country) |
| `date_posted` | String | Date when the job was posted |
| `description_html` | String | Full job description in HTML format |
| `description_text` | String | Job description in plain text |
| `url` | String | Direct URL to the job posting |

---

## Usage Examples

### Basic Job Search

Search for nursing jobs in New York:

```json
{
    "keyword": "nurse",
    "location": "New York",
    "posted_date": "7d",
    "maxJobs": 100
}
```

### Technology Jobs Search

Find recent software engineering positions:

```json
{
    "keyword": "software engineer",
    "location": "San Francisco",
    "posted_date": "24h",
    "collectDetails": true,
    "maxJobs": 50
}
```

### Direct URL Scraping

Use a specific Learn4Good search URL:

```json
{
    "startUrl": "https://www.learn4good.com/jobs/language/english/list/",
    "collectDetails": true,
    "maxJobs": 200
}
```

### Large-Scale Data Collection

Collect extensive job listings with pagination control:

```json
{
    "keyword": "data analyst",
    "posted_date": "30d",
    "maxJobs": 500,
    "maxPages": 50,
    "collectDetails": false
}
```

---

## Sample Output

```json
{
    "title": "Registered Nurse - ICU",
    "company": "City Medical Center",
    "location": "New York, NY",
    "date_posted": "2026-01-20",
    "description_html": "<p>Join our team as a Registered Nurse in our Intensive Care Unit...</p>",
    "description_text": "Join our team as a Registered Nurse in our Intensive Care Unit. We are seeking experienced RNs with critical care experience...",
    "url": "https://www.learn4good.com/jobs/registered-nurse-icu-12345"
}
```

---

## Tips for Best Results

### Choose Effective Keywords
- Use specific job titles for targeted results (e.g., "software engineer" vs "tech")
- Combine keywords with locations for regional searches
- Test different keyword variations to maximize coverage

### Optimize Collection Settings
- Start with smaller limits (50-100 jobs) for testing
- Enable `collectDetails` for comprehensive data, disable for faster scraping
- Set `maxPages` to prevent excessive crawling on broad searches

### Use Date Filters Wisely
- Use `24h` or `7d` for fresh job postings
- Use `30d` for broader market analysis
- Use `anytime` for comprehensive historical data

### Monitor Performance
- Balance `maxJobs` and `maxPages` based on your needs
- Disable `collectDetails` if descriptions aren't required
- Use appropriate proxy configuration for reliable access

---

## Integrations

Connect your job data with popular tools:

- **Google Sheets** — Export for analysis and sharing
- **Airtable** — Build searchable recruitment databases
- **Slack** — Get notifications for new job postings
- **Webhooks** — Send data to custom endpoints
- **Make** — Create automated recruitment workflows
- **Zapier** — Trigger actions based on new jobs

### Export Formats

Download your data in multiple formats:

- **JSON** — For developers and API integrations
- **CSV** — For spreadsheet analysis and reporting
- **Excel** — For business intelligence tools
- **XML** — For system integrations

---

## Frequently Asked Questions

### How many jobs can I collect?
You can collect up to the limit specified in `maxJobs`. The actor will automatically handle pagination to reach your target. For unlimited collection, leave `maxJobs` empty.

### Does the scraper work with direct URLs?
Yes, you can provide a Learn4Good search URL in the `startUrl` field. This will override keyword and location filters.

### What happens if I disable collectDetails?
The scraper will only extract data visible on listing pages, which is faster but may result in shorter or missing descriptions. Enable it for complete job information.

### Can I filter by posting date?
Yes, use the `posted_date` parameter to filter jobs posted within the last 24 hours, 7 days, 30 days, or anytime.

### How does pagination work?
The actor automatically navigates through result pages until it reaches `maxJobs` or `maxPages` limit, whichever comes first.

### What if some fields are empty?
Some jobs may not include all fields (e.g., company name or exact posting date). The scraper extracts all available information from the source.

### Do I need proxies?
The actor uses Apify datacenter proxies by default, which work well for most cases. You can configure custom proxies if needed.

### How long does a typical run take?
Runtime depends on the number of jobs and whether `collectDetails` is enabled. Expect 1-3 minutes per 100 jobs with details, faster without.

---

## Support

For issues or feature requests, contact support through the Apify Console.

### Resources

- [Apify Documentation](https://docs.apify.com/)
- [API Reference](https://docs.apify.com/api/v2)
- [Scheduling Runs](https://docs.apify.com/schedules)
- [Integrations](https://docs.apify.com/integrations)

---

## Legal Notice

This actor is designed for legitimate data collection purposes. Users are responsible for ensuring compliance with Learn4Good's terms of service and applicable laws. Use data responsibly and respect rate limits.