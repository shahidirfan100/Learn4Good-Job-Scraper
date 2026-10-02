## What does Learn4Good Jobs Scraper do?

Learn4Good Jobs Scraper collects public job listings from Learn4Good and saves them as structured dataset records. Provide a Learn4Good jobs URL, such as a category, search results, or listing page. Each record can include the job title, company, location, salary, employment type, posting information, description, job ID, and source URL.

The Actor first collects the result page, then tries to enrich each job with the original posting details, including the full description. If a detail page is temporarily unavailable, the useful list record is still kept. This makes it suitable for recruitment research, job market monitoring, and scheduled hiring datasets.

## Why use Learn4Good Jobs Scraper?

- **Recruitment research** - Build searchable job datasets for sourcing and outreach planning.
- **Hiring market monitoring** - Track roles by category, region, posting age, and employment type.
- **Scheduled collection** - Run repeat searches to monitor new openings over time.
- **Clean records** - Duplicate job links are removed during a run and empty fields are omitted.
- **Flexible coverage** - Point the Actor at any public Learn4Good jobs listing URL.
- **Full description enrichment** - Detail collection can add the complete published job description, employer, salary, dates, and requirements.
- **Partial-result protection** - A blocked or unavailable detail page does not remove the job from the dataset.

## What data can you extract from Learn4Good?

| Field              | Description                                            |
| ------------------ | ------------------------------------------------------ |
| `title`            | Job title shown in the listing or detail page          |
| `company`          | Hiring company when published by the source            |
| `location`         | Job city, region, country, or remote location          |
| `salary`           | Salary text when available                             |
| `job_type`         | Employment type such as full time, contract, or remote |
| `date_posted`      | Posting date or posting-age text                       |
| `valid_through`    | Expiration date when published                         |
| `description_html` | Sanitized HTML description when available              |
| `description_text` | Plain-text job description or list summary             |
| `url`              | Direct URL to the job posting                          |
| `job_id`           | Numeric Learn4Good job identifier                      |
| `search_keyword`   | Keyword used for the run                               |
| `search_location`  | Location used for the run                              |
| `source`           | Source label, `learn4good`                             |
| `scraped_at`       | ISO timestamp for the collected record                 |

## How to use Learn4Good Jobs Scraper

1. Open the Actor in Apify Console.
2. Paste a Learn4Good jobs URL.
3. Choose the maximum number of jobs and pages.
4. Decide whether to try detail-page enrichment.
5. Run the Actor and inspect the dataset.
6. Export the results as JSON, CSV, Excel, XML, or connect the dataset to another workflow.

## Input Parameters

| Parameter            | Type    | Required | Default        | Description                                                                                                                                 |
| -------------------- | ------- | -------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `startUrl`           | String  | Yes      | -              | Learn4Good jobs URL to collect, such as a category, search results, or listing page.                                                        |
| `maxJobs`            | Integer | No       | `20`           | Maximum number of unique jobs to save.                                                                                                      |
| `maxPages`           | Integer | No       | `25`           | Maximum number of result pages to inspect.                                                                                                  |
| `collectDetails`     | Boolean | No       | `true`         | Try to add company, full description, salary, posting date, and expiry fields. List data remains available if a detail page is unavailable. |
| `proxyConfiguration` | Object  | No       | Disabled (off) | Optional Apify Proxy or custom proxy settings. Disabled by default.                                                                         |

Provide the jobs URL. The Actor follows the listing's own pagination.

## Usage Examples

### Collect a category listing

Collect up to 20 jobs from the administrative category:

```json
{
    "startUrl": "https://www.learn4good.com/jobs/language/english/search/administrative/",
    "maxJobs": 20
}
```

### Collect a large listing without detail enrichment

Collect fast list-level records from any jobs listing page:

```json
{
    "startUrl": "https://www.learn4good.com/jobs/language/english/search/administrative/",
    "maxJobs": 100,
    "maxPages": 10,
    "collectDetails": false
}
```

## Sample Output

When detail enrichment is available, the dataset includes the published description and additional job metadata:

```json
{
    "title": "Sales Executive; Remote, International Clients",
    "company": "SATS International",
    "location": "Kasur, Pakistan",
    "salary": "30000 - 40000 PKR Monthly",
    "job_type": "Full Time, Remote/Work from Home",
    "date_posted": "2026-09-05",
    "description_html": "<p><strong>Position: Sales Executive (International Clients)</strong></p><p>SATS International is hiring a Sales Executive to handle foreign clients.</p><ul><li>Min 2 years sales experience</li><li>Strong English communication</li><li>Remote</li></ul>",
    "description_text": "Position: Sales Executive (International Clients) SATS International is hiring a Sales Executive to handle foreign clients. Min 2 years sales experience. Strong English communication. Remote.",
    "url": "https://www.learn4good.com/jobs/online_remote/sales/5263819189/e/",
    "job_id": "5263819189",
    "source": "learn4good",
    "scraped_at": "2026-09-14T06:50:00.000Z"
}
```

If the source does not make a detail document available, the Actor returns the list title, URL, job ID, location, posting hint, and summary instead. Company, salary, employment type, full description, ISO posting date, and expiry date depend on the information published for that job.

## Tips for best results

- Paste a category, search results, or listing URL that shows the jobs you want.
- Start with `maxJobs: 20` and a small `maxPages` value when testing a new URL.
- Keep `collectDetails` enabled when you need full descriptions and richer job metadata, or disable it when list coverage and speed are more important.
- No proxy is needed: if a request is temporarily blocked, the Actor automatically retries through an alternate route so a run still returns results. The `proxyConfiguration` field is available, and disabled by default, if you want to route requests through a proxy.
- Review several records before assuming an empty field is an extraction problem. Some employers do not publish salary, expiry, or company details.

## Integrations and exports

- **Google Sheets** - Review and filter job results in a shared spreadsheet.
- **Airtable** - Maintain a searchable hiring tracker.
- **Webhooks** - Send completed run notifications to another service.
- **Make and Zapier** - Trigger recruiting and enrichment workflows.
- **Apify API** - Retrieve datasets programmatically.
- **Exports** - Download JSON, CSV, Excel, XML, and other supported dataset formats.

## Frequently Asked Questions

### Which URL should I use?

Use any public Learn4Good jobs URL that lists jobs, such as a category page, a search results page, or a listing page. The Actor follows that page's pagination.

### What happens when a detail page is unavailable?

The Actor tries an alternate detail retrieval path and validates that it contains a real job description before parsing it. If the detail page is unavailable, the list record is kept, so the title, URL, job ID, location, posting hint, and summary can still be returned.

### Does the Actor remove duplicate jobs?

Yes. Records are deduplicated by job ID, URL, and a conservative content fingerprint during the run.

### Can I schedule recurring searches?

Yes. Create an Apify schedule to run the same input hourly, daily, weekly, or on another interval supported by your account.

### Can I export the dataset to CSV or Excel?

Yes. Apify dataset exports include JSON, CSV, Excel, XML, and other supported formats.

### Is it legal to collect Learn4Good data?

Use the Actor only for legitimate collection of public information. You are responsible for complying with Learn4Good terms, applicable laws, privacy requirements, and any restrictions that apply to your intended use.

## Support

For a source change, missing field, or feature request, use the Actor's issue or support channel in Apify Console and include the input mode and a small reproducible example.

## Legal Notice

This Actor is intended for responsible collection of publicly available job information. Users are responsible for respecting Learn4Good terms of use, applicable law, privacy obligations, and any access controls.
