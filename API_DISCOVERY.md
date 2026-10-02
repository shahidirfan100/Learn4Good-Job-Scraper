# Learn4Good API and source discovery

This document records the current investigation and the evidence behind the implemented request flow.

## Current actor audit

The actor accepts a Learn4Good jobs URL and publishes these stable fields when available:

- `title`
- `company`
- `location`
- `salary`
- `job_type`
- `date_posted`
- `valid_through`
- `description_html`
- `description_text`
- `url`
- `job_id`
- `search_keyword`
- `search_location`
- `source`
- `scraped_at`

## Discovery acceptance checks

The selected source had to:

1. Return current Learn4Good job listings with a stable URL and numeric job ID.
2. Support keyword search, an optional location, and page traversal.
3. Work without a hardcoded token or authentication secret.
4. Be replayable with an HTTP client profile.
5. Preserve the existing dataset field names and result limits.
6. Produce useful fallback records when detail enrichment is unavailable.

## Live probes performed

### List/search

The legacy GET endpoint was tested directly:

`https://www.learn4good.com/jobs/index.php?controller=job_list&action=display_search_results&page_number=1&what=nurse&where=New%20York`

Observed outcome:

- HTTP `200` with a valid page shell, but only **1 job cell** on every tested keyword and location.
- The single job was the same for `what`/`where`/`country_id` variants, so the GET parameters were ignored.
- The page listed a country-expansion hint, confirming the default result set is restricted to the visitor's present country.
- No Cloudflare challenge on this endpoint.

The real search form on the page posts to:

`https://www.learn4good.com/jobs/index.php?controller=job_search&action=flexible_search`

with fields `keywords`, `country_id`, `state_id`, `city_id`, `proximity_range`, `app_posting_lang_id`, `min_edu_level_id`, `time_period`, salary fields, and `present_country_only`.

A POST without a session returned the same degraded single-job page. Setting a `jobs_session` cookie first (obtained from a normal GET of the search-results URL), then POSTing the form with `keywords` and `present_country_only=0`, returned **20 relevant jobs per page**, and `page_number` traversal returned further distinct pages.

Evidence summary:

| Request                                                | Result                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------- |
| GET results URL, params in query                       | HTTP 200, 1 job, params ignored                               |
| POST flexible_search, no session cookie                | HTTP 200, 1 job, keyword ignored                              |
| GET results URL (seeds `jobs_session`) → POST with keyword | HTTP 200, **20 jobs**, keyword honoured, paginated          |
| `keywords="nurse New York"`                            | New York nurse jobs (location understood inside the keyword)  |
| `keywords=nurse` + `country_id=184`                    | United Kingdom nurse jobs                                     |
| `page_number=2` after POST                             | 20 further, distinct jobs                                     |
| Unknown keyword                                        | HTTP 200, 0 job cells (valid empty result)                    |

### Detail pages

Every tested browser profile returned Cloudflare `403` with a "Just a moment..." challenge for direct job detail URLs, including with a valid `jobs_session` cookie and a matching `Referer`:

`https://www.learn4good.com/jobs/<path>/<job_id>/e/` → HTTP `403`.

A translation-gateway request for the same detail URL returned the original Learn4Good document as HTML and was not challenged:

- Gateway URL pattern: `https://<source-host-with-dots-replaced-by-dashes>.translate.goog/<path>?_x_tr_sl=auto&_x_tr_tl=en&_x_tr_hl=en`
- HTTP `200`, approximately `72–83 KB`
- `div[itemprop="description"]` present, with `validThrough`, `Listing for:` employer text, salary, and full description
- No challenge marker

The gateway accepts `GET` only. A `POST` to the gateway returned `405`/`429`, so it is used only for detail retrieval.

### `impit` profile matrix

The list/search endpoint was tested with every browser value supported by `impit` `0.14.5`:

| Profile                                | List/search result              |
| -------------------------------------- | ------------------------------- |
| `chrome`                               | HTTP 200, valid                  |
| `chrome124` … `chrome151`              | HTTP 200, valid                  |
| `chrome100` … `chrome116`              | TLS `ConnectError` in the test environment |
| `firefox`, `firefox128` … `firefox144` | HTTP 200, valid                  |
| `okhttp`, `okhttp3` … `okhttp5`        | HTTP 200, valid                  |
| `ios18`                                | TLS `ConnectError` in the test environment |

`chrome` was selected as the default profile. It is current, valid, and stable for the tested flow.

## Candidate source matrix

| Candidate                         | Request profile                        | Result                                                        | Fields                                          | Pagination                         | Decision                       |
| --------------------------------- | -------------------------------------- | ------------------------------------------------------------: | ----------------------------------------------- | ---------------------------------- | ------------------------------ |
| Learn4Good search results         | GET (query parameters)                 | HTTP 200, 1 job, parameters ignored                           | title, URL, ID only                             | None                               | Rejected                       |
| Learn4Good flexible search        | GET session + POST `flexible_search`   | HTTP 200, 20 relevant jobs per page                           | title, URL, ID, location, posting-age, category, snippet, employer | `page_number`             | **Selected (primary list)**   |
| Learn4Good detail page            | `impit` Chrome (all variants)          | HTTP 403 Cloudflare challenge                                 | No detail fields                                | Not applicable                     | Rejected                       |
| Google translation detail gateway | `impit` Chrome                         | HTTP 200, valid detail HTML                                   | title, company, salary, dates, full description | Single detail URL                  | **Selected (detail)**         |
| Browser automation (Patchright)   | Chrome                                 | Detail pages challenged; heavy startup, unreliable in cloud   | No reliable detail fields                       | Not applicable                     | Removed                        |
| JSON-LD                           | All tested list pages                  | No JSON-LD scripts containing job rows                        | 0                                               | None                               | Rejected                       |
| Hydration globals                 | All tested list pages                  | No `__NEXT_DATA__` or initial-state payload                    | 0                                               | None                               | Rejected                       |
| Hidden JSON listing API           | Direct endpoint search                 | No reproducible JSON response with job rows                    | No job rows                                     | None                               | Rejected                       |

## Selected source

- **Primary list source:** the user-supplied Learn4Good jobs URL (a category, search results, or listing page)
- **Method:** direct `GET`; if the direct response is blocked or degraded, a `GET` of the same URL through the translation gateway
- **Authentication:** None
- **Client:** `impit` `0.14.5`, `chrome` profile, no proxy
- **Headers:** `impit` supplies the browser fingerprint. Only a `Referer` is added to direct requests.
- **Pagination:** the listing's own next-page link, with `page_number` increment and a bounded `maxPages` limit
- **List fields:** job title, job URL, numeric job ID, location, posting-age text, category, description snippet, and employer
- **Detail source:** translation-gateway URL built from each direct job URL, fetched with the same `impit` client
- **Detail fields when available:** company, salary, job type, ISO posting date, valid-through date, sanitized HTML description, and plain-text description
- **Fallback behavior:** If detail retrieval is unavailable, the list-level job record is still saved.

## Implementation decision

The actor is URL-only and uses a fast, HTTP-only pipeline. Proxy use is optional and disabled by default:

1. Create one `impit` client with the `chrome` profile. When the optional `proxyConfiguration` input is enabled, the client is created with that proxy URL; otherwise it runs without a proxy.
2. GET the supplied jobs URL directly.
3. If the direct response is blocked by Cloudflare, or is the degraded country-restricted page (0–1 jobs), re-fetch the same URL through the translation gateway and normalize gateway job links back to direct Learn4Good URLs.
4. Once gateway mode is active, continue in gateway mode for subsequent pages.
5. Parse list pages with Cheerio.
6. Enrich each list record by fetching its translation-gateway detail URL with bounded concurrency and a per-request timeout.
7. Keep the list-level record when a detail page is unavailable.
8. Push records in batches, stop at `maxJobs` or `maxPages`, and stop early when a page yields no new jobs.
9. Stop with zero results only when the URL genuinely lists no jobs.

### Blocked-request recovery

Cloudflare blocks the listing endpoint for datacenter IPs, so the direct request is usually challenged when the actor runs in the cloud. The same run previously failed with HTTP `403` and `stop_reason=list_blocked`, returning zero results. The actor now recovers without a proxy:

1. A blocked or degraded direct page (0–1 jobs, which is the country-restricted page) is re-fetched through the translation gateway. The gateway serves the real listing, and gateway job links are normalized back to direct Learn4Good URLs. Verified: `https://www.learn4good.com/jobs/language/english/search/administrative/` returns its full administrative listing through the gateway.
2. Because the URL path identifies the listing, the gateway preserves the exact job set, unlike query-parameter search.

Patchright, Apify Unblocker, and proxy handling were removed. Detail pages and the fallback listing need no proxy, so the actor runs without any proxy configuration.

This is intentionally not described as a guaranteed anti-bot bypass. `impit` and the translation gateway improve access, but the target can still apply Cloudflare controls.

## Rejected approaches

- **Query-parameter GET search:** Returns a degraded single-result page; parameters are ignored without a session and a `flexible_search` POST.
- **Direct detail scraping:** Every tested direct detail request returned a Cloudflare challenge, including with a session cookie.
- **Browser automation (Patchright):** Removed after the HTTP paths above proved sufficient. It did not provide a reliable detail response and added significant runtime and image weight.
- **Manual random browser headers:** Rejected because they can mix a user agent with an inconsistent TLS/header profile. `impit` owns the browser profile.
- **Query-parameter keyword search:** The gateway GET ignores search parameters and direct query-parameter search is degraded, so keyword/location/date inputs were removed in favor of explicit listing URLs.

## Production caveats

- The actor is URL-only. The URL path identifies the listing, so the gateway fallback returns exactly that listing's jobs.
- Detail-only fields can still be absent when the translation gateway is unavailable. The list record is retained.
- List `date_posted` can be a relative value such as `1 week ago` when the detail page does not provide an ISO date.
- The translation gateway depends on that public service's availability and response policy; it is validated before parsing and never treated as successful from HTTP status alone.
- `proxyConfiguration` is optional and disabled by default (`useApifyProxy: false`). With no proxy, datacenter exit IPs are usually challenged by Cloudflare on the direct request, so the run typically continues through the translation gateway. When a proxy is enabled, the direct request may succeed and the gateway is not needed.
- The target controls response availability, so no HTTP client can guarantee access to every page.
