# API Discovery

## Existing Actor Audit
- Existing extraction fields in `src/main.js`: `title`, `company`, `location`, `salary`, `job_type`, `date_posted`, `description_html`, `description_text`, `url`.
- Existing input fields: `startUrl`, `keyword`, `location`, `posted_date`, `collectDetails`, `maxJobs`, `maxPages`, `proxyConfiguration`.
- Missing/high-value fields identified: `job_id`, `valid_through`, `search_keyword`, `search_location`, `source`, `scraped_at`.

## URLScan Discovery Evidence
- Domain search used: `https://urlscan.io/api/v1/search/?q=domain:learn4good.com`
- Most useful successful scan analyzed: `019be6f3-605a-715e-a442-b64a8b663430` (HTTP 200 page).
- Full scan JSON: `https://urlscan.io/api/v1/result/019be6f3-605a-715e-a442-b64a8b663430/`
- DOM snapshot used for inline endpoint discovery: `https://urlscan.io/dom/019be6f3-605a-715e-a442-b64a8b663430/`

## Candidate Endpoints

### Candidate A
- Endpoint: `https://www.learn4good.com/jobs/index.php?controller=job_list&action=display_search_results&page_number=<n>&what=<keyword>&where=<location>`
- Method: `GET`
- Auth: None
- Pagination: `page_number`
- Response type: HTML result set (job links + metadata)
- Field availability: list-level title/company/location/date hints + job URLs

### Candidate B
- Endpoint: `https://www.learn4good.com/jobs/index.php?controller=job_search&action=completion&q=<keyword>`
- Method: `GET`
- Auth: None
- Pagination: None
- Response type: JSON autocomplete only
- Field availability: keyword suggestions, no job listing payload

### Candidate C
- Endpoint: `https://www.learn4good.com/jobs/index.php?controller=location_list&action=load_states&country_id=<id>`
- Method: `GET`
- Auth: None
- Pagination: None
- Response type: JSON options data
- Field availability: location filter options only

### Candidate D
- Endpoint: `https://www.learn4good.com/jobs/index.php?controller=dynamic_options&action=get_categories`
- Method: `GET`
- Auth: None
- Pagination: None
- Response type: JSON options data
- Field availability: category options only

## Scoring (per apify-updater rules)

| Candidate | Returns JSON directly (+30) | >15 useful job fields (+25) | No auth (+20) | Pagination (+15) | Matches/extents job fields (+10) | Total |
|---|---:|---:|---:|---:|---:|---:|
| A (job_list HTML endpoint) | 0 | 10 | 20 | 15 | 10 | 45 |
| B (completion) | 30 | 0 | 20 | 0 | 0 | 50 |
| C (load_states) | 30 | 0 | 20 | 0 | 0 | 50 |
| D (get_categories) | 30 | 0 | 20 | 0 | 0 | 50 |

## Selected API
- Endpoint: `https://www.learn4good.com/jobs/index.php?controller=job_list&action=display_search_results&page_number=<n>&what=<keyword>&where=<location>`
- Method: `GET`
- Auth: None
- Pagination: `page_number`
- Fields available: listing-level data + links to detail pages that expose additional structured fields (`datePosted`, `validThrough`, `jobLocation`, `hiringOrganization`, job content).
- Fields currently missing in actor and now targeted: `job_id`, `valid_through`, `search_keyword`, `search_location`, `source`, `scraped_at`.
- Field count target: 15+ in merged list/detail output (vs prior 9 core fields).

## Why Other Candidates Were Rejected
- `completion`, `load_states`, and `get_categories` are JSON but do not return job listings; they are support endpoints for UI controls.
- They cannot produce dataset rows representing jobs, so they are unsuitable as the main extraction source.

## Runtime Notes
- Direct HTTP to Learn4Good may intermittently hit anti-bot pages depending on IP reputation.
- The actor remains fully HTTP-based with `gotScraping` and proxy support, without Playwright fallback.
- No additional auth tokens or cookies are required by design, but user-supplied cookies are accepted when needed.
