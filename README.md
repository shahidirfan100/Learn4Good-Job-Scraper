# Learn4Good Job Scraper

This Apify actor scrapes job listings from Learn4Good.com. It is designed to be fast and lightweight, using HTTP requests and Cheerio for parsing.

## Features

- Scrapes Learn4Good job search results.
- Extracts detailed job information including title, company, location, date, and full description.
- Handles pagination to collect multiple pages of results.
- Saves results to a dataset.

## Input

The actor accepts the following input fields:

- `keyword`: The job title or keywords to search for (required).
- `location`: The geographic location to filter jobs by.
- `posted_date`: Filter jobs by when they were posted (e.g., "24h", "7d", "30d").
- `results_wanted`: The maximum number of jobs to scrape.
- `proxyConfiguration`: Proxy settings for the scraper.

## Output

The actor outputs a dataset of job listings with the following fields:

- `title`: The job title.
- `company`: The company name.
- `location`: The job location.
- `date_posted`: When the job was posted.
- `description_html`: The job description in HTML format.
- `description_text`: The job description in plain text.
- `url`: The URL of the job posting.