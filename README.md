# Learn4Good Job Scraper

This Apify actor scrapes job listings from Learn4Good.com. It is designed to be fast and lightweight, using HTTP requests and Cheerio for parsing, and now uses Apify datacenter proxies by default to avoid common blocks during quality review.

## Features

- Scrapes Learn4Good job search results.
- Extracts detailed job information including title, company, location, date, and full description.
- Handles pagination to collect multiple pages of results.
- Saves results to a dataset.

## Input

The actor accepts the following input fields:

- `startUrl` *(string)*: Optional Learn4Good search URL. When set it overrides keyword/location filters.
- `keyword` *(string)*: Keyword to search for when `startUrl` is empty. Defaults to `nurse`.
- `location` *(string)*: Optional location filter to combine with the keyword.
- `posted_date` *(enum)*: One of `24h`, `7d`, `30d`, or `anytime` (default). Applies a recent-posted filter.
- `collectDetails` *(boolean)*: If `true`, visit each job detail page for full descriptions (default `true`).
- `maxJobs` *(integer)*: Upper limit on collected jobs. Leave empty to collect all results.
- `maxPages` *(integer)*: Safety cap on listing pages to crawl. Leave empty for no cap.
- `cookies` *(string)*: Optional raw `Cookie` header to inject on every request.
- `proxyConfiguration` *(object)*: Optional proxy override. When omitted the actor uses Apify datacenter proxies automatically.

## Output

The actor outputs a dataset of job listings with the following fields:

- `title`: The job title.
- `company`: The company name.
- `location`: The job location.
- `date_posted`: When the job was posted.
- `description_html`: The job description in HTML format.
- `description_text`: The job description in plain text.
- `url`: The URL of the job posting.