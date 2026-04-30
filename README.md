# Learn4Good Jobs Scraper

Collect structured job listings from Learn4Good with keyword/location search or direct result URLs. The actor captures listing data plus detail-page fields such as descriptions, posting dates, and expiry metadata for reliable job research datasets.

## Features

- **Structured Job Records** — Extract title, company, location, posting date, description, and source URL
- **Flexible Input** — Run by `keyword` + `location` or pass a direct `startUrl`
- **Pagination Support** — Continue through multiple pages until reaching your limits
- **Cleaner Output** — Skips duplicate records and removes null/empty fields
- **Run Metadata** — Includes context fields such as search keyword, search location, and scrape timestamp

## Use Cases

### Recruitment Intelligence
Build fresh job datasets for sourcing, outreach planning, and regional hiring analysis.

### Job Market Monitoring
Track role demand by keyword and geography over repeated scheduled runs.

### Competitive Research
Watch openings by sector and location to understand hiring velocity and expansion patterns.

---

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `startUrl` | String | No | — | Direct Learn4Good search URL (overrides keyword/location) |
| `keyword` | String | No | `"nurse"` | Job keyword used when `startUrl` is not provided |
| `location` | String | No | `"New York"` | Location filter used when `startUrl` is not provided |
| `maxJobs` | Integer | No | `20` | Maximum number of jobs to save |
| `maxPages` | Integer | No | `25` | Maximum number of result pages to visit |
| `proxyConfiguration` | Object | No | Apify datacenter | Optional proxy override |

---

## Output Data

Each dataset item can contain:

| Field | Type | Description |
|-------|------|-------------|
| `title` | String | Job title |
| `company` | String | Hiring company |
| `location` | String | Job location |
| `salary` | String | Salary text when available |
| `job_type` | String | Employment type when available |
| `date_posted` | String | Posting date when available |
| `valid_through` | String | Expiry date when available |
| `description_html` | String | Description in HTML format |
| `description_text` | String | Description in plain text |
| `job_id` | String | Job ID parsed from URL |
| `url` | String | Job detail URL |
| `search_keyword` | String | Keyword used for this run |
| `search_location` | String | Location used for this run |
| `source` | String | Source site label |
| `scraped_at` | String | ISO timestamp when record was saved |

---

## Usage Examples

### Basic Keyword Search

```json
{
    "keyword": "software engineer",
    "location": "United States",
    "maxJobs": 20
}
```

### Direct URL Run

```json
{
    "startUrl": "https://www.learn4good.com/jobs/index.php?controller=job_list&action=display_search_results&page_number=1&what=data+analyst",
    "maxJobs": 50,
    "maxPages": 10
}
```

### Large Monitoring Run

```json
{
    "keyword": "nurse",
    "location": "New York",
    "maxJobs": 200,
    "maxPages": 25
}
```

---

## Sample Output

```json
{
    "title": "Registered Nurse",
    "company": "City Medical Center",
    "location": "New York, United States",
    "job_type": "Full Time",
    "date_posted": "2026-01-17",
    "valid_through": "2026-07-16",
    "description_text": "Join our team as a Registered Nurse...",
    "job_id": "4795940857",
    "url": "https://www.learn4good.com/jobs/tucson/arizona/healthcare/4795940857/e/",
    "search_keyword": "nurse",
    "search_location": "New York",
    "source": "learn4good",
    "scraped_at": "2026-04-30T10:05:00.000Z"
}
```

---

## Tips for Best Results

### Start Small
- Run with `maxJobs: 20` first to validate inputs quickly.

### Use Specific Keywords
- Precise titles such as `icu nurse` or `frontend developer` typically return cleaner results.

### Tune Page Limits
- Increase `maxPages` only when you need broader coverage.

---

## Integrations

Connect output with:

- **Google Sheets** — Share and filter job datasets
- **Airtable** — Build searchable hiring trackers
- **Webhooks** — Push new data to your systems
- **Make** — Automate enrichment workflows
- **Zapier** — Trigger downstream actions

### Export Formats

- **JSON** — API and programmatic workflows
- **CSV** — Spreadsheet analysis
- **Excel** — Reporting
- **XML** — System integrations

---

## Frequently Asked Questions

### Can I run without a keyword?
Yes. Provide a `startUrl` directly.

### Why are some fields missing in a row?
Some listings do not publish every field. The actor stores only non-empty values.

### Does it avoid duplicates?
Yes. Duplicate records are skipped during the run.

### How do I collect more data?
Increase `maxJobs` and `maxPages`.

### Is proxy configuration required?
No. Default proxy behavior is already configured, but you can override it.

---

## Support

For issues or feature requests, use the Apify Console.

### Resources

- [Apify Documentation](https://docs.apify.com/)
- [API Reference](https://docs.apify.com/api/v2)
- [Scheduling Runs](https://docs.apify.com/schedules)

---

## Legal Notice

Use this actor in compliance with Learn4Good terms and applicable laws.
