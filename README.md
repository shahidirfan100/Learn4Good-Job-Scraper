# Learn4Good Job Scraper

A powerful and efficient Apify actor designed to scrape job listings from Learn4Good.com. This actor automates the collection of job data, including titles, companies, locations, posting dates, and detailed descriptions, making it ideal for job market analysis, recruitment, and research purposes.

## Features

- **Comprehensive Scraping**: Extracts detailed job information from Learn4Good job search results.
- **Pagination Support**: Automatically handles multiple pages to collect extensive job listings.
- **Flexible Filtering**: Supports keyword and location-based searches with customizable date filters.
- **Detailed Extraction**: Retrieves full job descriptions and metadata.
- **Proxy Integration**: Utilizes Apify datacenter proxies to ensure reliable data collection.
- **Configurable Limits**: Allows setting maximum jobs or pages to control data volume.

## Input

The actor accepts input parameters to customize the scraping process. Below is a detailed table of available input fields:

| Field | Type | Description | Default |
|-------|------|-------------|---------|
| `startUrl` | string | Optional Learn4Good search URL. Overrides keyword/location filters when provided. | - |
| `keyword` | string | Keyword for job search. | "nurse" |
| `location` | string | Optional location filter combined with the keyword. | - |
| `posted_date` | enum | Date filter: `24h`, `7d`, `30d`, or `anytime`. | "anytime" |
| `collectDetails` | boolean | Whether to visit job detail pages for full descriptions. | true |
| `maxJobs` | integer | Maximum number of jobs to collect. Leave empty for unlimited. | - |
| `maxPages` | integer | Maximum number of listing pages to crawl. Leave empty for no limit. | - |
| `cookies` | string | Optional raw Cookie header for requests. | - |
| `proxyConfiguration` | object | Custom proxy settings. Uses Apify datacenter proxies if omitted. | - |

### Input Example

```json
{
  "keyword": "software engineer",
  "location": "New York",
  "posted_date": "7d",
  "collectDetails": true,
  "maxJobs": 100
}
```

## Output

The actor stores scraped job listings in a dataset. Each item includes the following fields:

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | The job title. |
| `company` | string | The company name. |
| `location` | string | The job location. |
| `date_posted` | string | The date the job was posted. |
| `description_html` | string | The job description in HTML format. |
| `description_text` | string | The job description in plain text. |
| `url` | string | The URL of the job posting. |

### Output Example

```json
{
  "title": "Registered Nurse",
  "company": "City Hospital",
  "location": "New York, NY",
  "date_posted": "2023-10-15",
  "description_html": "<p>Join our team...</p>",
  "description_text": "Join our team as a Registered Nurse...",
  "url": "https://www.learn4good.com/jobs/registered-nurse-12345"
}
```

## Usage

### Running the Actor

1. **Via Apify Console**:
   - Navigate to the actor page on Apify.
   - Configure input parameters as needed.
   - Click "Run" to start the scraping process.

2. **Via API**:
   - Use the Apify API to run the actor programmatically.
   - Example API call:

     ```bash
     curl -X POST "https://api.apify.com/v2/acts/shahidirfan100~learn4good-job-scraper/runs?token=YOUR_API_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "keyword": "data analyst",
       "location": "San Francisco",
       "maxJobs": 50
     }'
     ```

3. **Retrieving Results**:
   - After the run completes, download the dataset from the Apify console or via API.
   - Results are available in JSON format for easy integration.

### Best Practices

- Set `maxJobs` or `maxPages` to avoid excessive data collection and potential rate limits.
- Use `collectDetails` wisely; disabling it speeds up scraping but limits description depth.
- Monitor proxy usage to ensure compliance with Apify's terms.

## Configuration

- **Proxy Settings**: By default, the actor uses Apify datacenter proxies. Override with `proxyConfiguration` for custom proxies.
- **Cookies**: Inject custom cookies via the `cookies` field for sites requiring authentication or session handling.
- **Limits**: Configure `maxJobs` and `maxPages` based on your data needs and system resources.

For advanced configurations, refer to the Apify documentation on actor inputs and proxy management.

## Support

If you encounter issues or have questions, please check the Apify community forums or contact support through the Apify platform.