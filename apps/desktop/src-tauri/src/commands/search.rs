// ─── Web Search ──────────────────────────────────────────────────────────────
// Provider abstraction for web search. The DuckDuckGo HTML provider is the
// default (no API key required); additional providers (Tavily, Brave, SearXNG)
// can be added by implementing SearchProvider and selecting them here.

use scraper::{Html, Selector};
use serde::Serialize;
use std::collections::HashSet;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use super::browser::shared_client;
use super::security::BrowserError;

const DDG_ENDPOINT: &str = "https://html.duckduckgo.com/html/";
/// Fallback endpoint: the lite UI is blocked by anti-bot checks far less
/// often than the html UI, so it doubles as a resilience path when CAPTCHA
/// or anomaly responses hit the primary endpoint.
const LITE_DDG_ENDPOINT: &str = "https://lite.duckduckgo.com/lite/";
const MAX_RESULTS_LIMIT: usize = 10;
const ANOMALY_MARKERS: [&str; 8] = [
    "anomaly",
    "challenge",
    "captcha",
    "are you a robot",
    "puzzle",
    "unusual traffic",
    "verify you are human",
    "not a robot",
];

/// After the engine blocks us, further requests in this window fail fast
/// instead of hammering the engine (which escalates the block) or making the
/// agent believe a retry will succeed.
const ENGINE_BLOCK_COOLDOWN: Duration = Duration::from_secs(45);

static LAST_ENGINE_BLOCK: Mutex<Option<Instant>> = Mutex::new(None);

fn in_cooldown(last_blocked: Option<Instant>, now: Instant) -> bool {
    matches!(
        last_blocked,
        Some(at) if now.saturating_duration_since(at) < ENGINE_BLOCK_COOLDOWN
    )
}

fn engine_blocked_cooldown_active() -> bool {
    let Ok(guard) = LAST_ENGINE_BLOCK.lock() else {
        return false;
    };
    in_cooldown(*guard, Instant::now())
}

fn mark_engine_blocked() {
    if let Ok(mut guard) = LAST_ENGINE_BLOCK.lock() {
        *guard = Some(Instant::now());
    }
}

// ─── Types ───────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct WebSearchResult {
    query: String,
    results: Vec<SearchResultItem>,
}

#[derive(Debug, Serialize)]
pub struct SearchResultItem {
    title: String,
    url: String,
    snippet: String,
}

// ─── Provider Abstraction ────────────────────────────────────────────────────

trait SearchProvider {
    async fn search(
        &self,
        client: &reqwest::Client,
        query: &str,
        max_results: usize,
    ) -> Result<Vec<SearchResultItem>, BrowserError>;
}

// ─── DuckDuckGo Provider ─────────────────────────────────────────────────────
// Primary endpoint is the html UI; when it comes back blocked, empty or
// errored, one fallback attempt goes to the lite UI before giving up.

struct DuckDuckGoProvider;

impl SearchProvider for DuckDuckGoProvider {
    async fn search(
        &self,
        client: &reqwest::Client,
        query: &str,
        max_results: usize,
    ) -> Result<Vec<SearchResultItem>, BrowserError> {
        // Fast-fail during the cooldown so agent retries never hit the engine.
        if engine_blocked_cooldown_active() {
            return Err(BrowserError::EngineBlocked);
        }

        let encoded = urlencoding::encode(query);
        let html_url = format!("{DDG_ENDPOINT}?q={encoded}");
        let lite_url = format!("{LITE_DDG_ENDPOINT}?q={encoded}");

        let html_outcome =
            fetch_results(client, &html_url, max_results, parse_duckduckgo_results).await;

        // Primary success (non-empty) wins immediately.
        if matches!(&html_outcome, Ok(items) if !items.is_empty()) {
            return html_outcome;
        }

        let lite_outcome = fetch_results(client, &lite_url, max_results, parse_lite_results).await;

        match lite_outcome {
            Ok(items) => Ok(items),
            Err(err) => {
                if matches!(err, BrowserError::EngineBlocked) {
                    mark_engine_blocked();
                }
                // A definitive block on either endpoint beats a transient
                // network failure on the other one — the agent must know the
                // engine is refusing requests, not that the network is down.
                if matches!(err, BrowserError::Network(_)) {
                    if let Err(blocked) = &html_outcome {
                        if matches!(blocked, BrowserError::EngineBlocked) {
                            mark_engine_blocked();
                            return Err(BrowserError::EngineBlocked);
                        }
                    }
                }
                Err(err)
            }
        }
    }
}

/// Fetches one search endpoint and parses the response.
async fn fetch_results(
    client: &reqwest::Client,
    url: &str,
    max_results: usize,
    parse: fn(&str, usize) -> Vec<SearchResultItem>,
) -> Result<Vec<SearchResultItem>, BrowserError> {
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| BrowserError::Network(format!("GET {url}: {e}")))?;

    let status = resp.status().as_u16();
    if !(200..300).contains(&status) {
        return Err(BrowserError::HttpStatus {
            status,
            url: url.to_string(),
        });
    }

    let html = resp
        .text()
        .await
        .map_err(|e| BrowserError::Network(e.to_string()))?;

    parse_search_response(&html, max_results, parse)
}

/// Parses a search-engine HTML response into results.
///
/// Returns `EngineBlocked` when zero results were extracted AND the page looks
/// like an anti-bot/blocked page — a blocked search must never be reported as
/// "no results found" (that would silently mislead the agent).
fn parse_search_response(
    html: &str,
    max_results: usize,
    parse: fn(&str, usize) -> Vec<SearchResultItem>,
) -> Result<Vec<SearchResultItem>, BrowserError> {
    let items = parse(html, max_results);
    if items.is_empty() && page_looks_blocked(html) {
        return Err(BrowserError::EngineBlocked);
    }
    Ok(items)
}

fn parse_duckduckgo_results(html: &str, max_results: usize) -> Vec<SearchResultItem> {
    let document = Html::parse_document(html);

    let result_selector = match Selector::parse(".result") {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let title_selector = match Selector::parse(".result__a") {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let snippet_selector = match Selector::parse(".result__snippet") {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let url_selector = match Selector::parse(".result__url") {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    let mut items = Vec::new();
    let mut seen = HashSet::new();

    for result in document.select(&result_selector) {
        if items.len() >= max_results {
            break;
        }

        let title = result
            .select(&title_selector)
            .next()
            .map(|e| e.text().collect::<String>().trim().to_string())
            .unwrap_or_default();
        if title.is_empty() {
            continue;
        }

        let snippet = result
            .select(&snippet_selector)
            .next()
            .map(|e| e.text().collect::<String>().trim().to_string())
            .unwrap_or_default();

        // The canonical URL lives in the title link's href (DuckDuckGo wraps it
        // in a redirect). The visible `.result__url` text is only a display
        // domain — using it as the URL would drop the path.
        let href = result
            .select(&title_selector)
            .next()
            .and_then(|e| e.value().attr("href"));
        let url = href_to_url(href).or_else(|| {
            result
                .select(&url_selector)
                .next()
                .map(|e| e.text().collect::<String>().trim().to_string())
                .filter(|u| !u.is_empty())
        });

        let Some(url) = url else {
            continue;
        };

        if seen.insert(url.clone()) {
            items.push(SearchResultItem {
                title,
                url,
                snippet,
            });
        }
    }

    items
}

/// Parses the lite.duckduckgo.com results markup.
///
/// Each result is a `<table class="results">` containing a snippet row
/// (`td.result-snippet`) and a link row (`td.result-link > a`). The parser is
/// tolerant: the first anchor with an href in the table provides the title and
/// URL (hrefs are direct or `uddg=` redirects, both handled by `href_to_url`).
fn parse_lite_results(html: &str, max_results: usize) -> Vec<SearchResultItem> {
    let document = Html::parse_document(html);

    let container_selector = match Selector::parse("table.results") {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let anchor_selector = match Selector::parse("a[href]") {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let snippet_selector = match Selector::parse(".result-snippet") {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    let mut items = Vec::new();
    let mut seen = HashSet::new();

    for container in document.select(&container_selector) {
        if items.len() >= max_results {
            break;
        }

        let Some(link) = container.select(&anchor_selector).next() else {
            continue;
        };
        let title = link.text().collect::<String>().trim().to_string();
        if title.is_empty() {
            continue;
        }
        let Some(url) = href_to_url(link.value().attr("href")) else {
            continue;
        };

        let snippet = container
            .select(&snippet_selector)
            .next()
            .map(|e| e.text().collect::<String>().trim().to_string())
            .unwrap_or_default();

        if seen.insert(url.clone()) {
            items.push(SearchResultItem {
                title,
                url,
                snippet,
            });
        }
    }

    items
}

/// Decodes a DuckDuckGo result href into the real destination URL.
///
/// DDG links look like `//duckduckgo.com/l/?uddg=<urlencoded>&rut=<token>`.
/// Only the `uddg=` parameter is the real URL; trailing params (rut, etc.)
/// must be dropped before decoding or they leak into the final URL.
fn href_to_url(href: Option<&str>) -> Option<String> {
    let href = href?.trim();
    if href.is_empty() {
        return None;
    }

    let decoded = if let Some(pos) = href.find("uddg=") {
        let param = &href[pos + 5..];
        let param = param.split('&').next().unwrap_or(param);
        urlencoding::decode(param).ok().map(|d| d.into_owned())
    } else {
        Some(href.to_string())
    }?;
    let decoded = decoded.trim().to_string();
    if decoded.is_empty() {
        return None;
    }

    // Protocol-relative or root-relative links get absolute forms.
    if decoded.starts_with("//") {
        Some(format!("https:{decoded}"))
    } else if decoded.starts_with('/') {
        Some(format!("https://duckduckgo.com{decoded}"))
    } else {
        Some(decoded)
    }
}

fn page_looks_blocked(html: &str) -> bool {
    let lower = html.to_lowercase();
    ANOMALY_MARKERS.iter().any(|m| lower.contains(m))
}

// ─── Command ─────────────────────────────────────────────────────────────────
// Note: Tauri matches invoke payload keys to the parameter names (camelCased).
// A single `args: Struct` parameter would require `{ args: {...} }` from the
// client, so optional arguments use plain `Option` parameters instead.

#[tauri::command]
pub async fn web_search(
    query: String,
    max_results: Option<usize>,
) -> Result<WebSearchResult, String> {
    let query = query.trim().to_string();
    if query.is_empty() {
        return Err(BrowserError::EmptyQuery.message());
    }

    // Clamp defensively in the backend: the harness clamps too, but the
    // backend is the final authority (0 would return nothing, huge values
    // would flood the agent context).
    let max_results = max_results.unwrap_or(5).clamp(1, MAX_RESULTS_LIMIT);

    let client = shared_client().map_err(|e| e.message())?;
    let provider = DuckDuckGoProvider;
    let results = provider
        .search(&client, &query, max_results)
        .await
        .map_err(|e| e.message())?;

    Ok(WebSearchResult { query, results })
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    const RESULTS_FIXTURE: &str = r#"
        <html><body>
          <div id="links">
            <div class="result results_links results_links_deep web-result">
              <h2 class="result__title">
                <a rel="nofollow" class="result__a"
                   href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage%3Fq%3D1%26x%3D2&amp;rut=abc123">
                  Example Page — Title
                </a>
              </h2>
              <a class="result__snippet" href="//duckduckgo.com/l/?uddg=...">
                This is the example snippet for the first result.
              </a>
              <div class="result__extras">
                <a class="result__url" href="//example.com/page?q=1&amp;x=2">example.com</a>
              </div>
            </div>
            <div class="result results_links results_links_deep web-result">
              <h2 class="result__title">
                <a rel="nofollow" class="result__a"
                   href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fguide&amp;rut=xyz">
                  Second Result
                </a>
              </h2>
              <a class="result__snippet" href="//duckduckgo.com/l/?uddg=...">
                Snippet number two.
              </a>
              <div class="result__extras">
                <a class="result__url" href="//example.org/guide">example.org</a>
              </div>
            </div>
            <div class="result results_links results_links_deep web-result">
              <h2 class="result__title">
                <a rel="nofollow" class="result__a" href="https://plain.example.com/no-redirect">
                  Plain Href Result
                </a>
              </h2>
              <div class="result__extras">
                <a class="result__url" href="https://plain.example.com/no-redirect">plain.example.com</a>
              </div>
            </div>
            <div class="result no-link">
              <h2 class="result__title"><a class="result__a">No href at all</a></h2>
            </div>
          </div>
        </body></html>
    "#;

    #[test]
    fn parses_results_with_full_decoded_urls() {
        let items = parse_duckduckgo_results(RESULTS_FIXTURE, 10);
        assert_eq!(items.len(), 3);

        assert_eq!(items[0].title, "Example Page — Title");
        // uddg= decoded, rut= dropped, protocol-relative made absolute
        assert_eq!(items[0].url, "https://example.com/page?q=1&x=2");
        assert_eq!(
            items[0].snippet,
            "This is the example snippet for the first result."
        );

        assert_eq!(items[1].url, "https://example.org/guide");
        // href without uddg= wrapper is kept as-is
        assert_eq!(items[2].url, "https://plain.example.com/no-redirect");
    }

    #[test]
    fn respects_max_results() {
        let items = parse_duckduckgo_results(RESULTS_FIXTURE, 2);
        assert_eq!(items.len(), 2);
    }

    #[test]
    fn deduplicates_repeated_urls() {
        let html = r#"
            <div class="result">
              <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fx&amp;rut=1">One</a>
            </div>
            <div class="result">
              <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fx&amp;rut=2">Two</a>
            </div>
        "#;
        let items = parse_duckduckgo_results(html, 10);
        assert_eq!(items.len(), 1);
    }

    #[test]
    fn skips_results_without_title_or_url() {
        let html = r#"
            <div class="result"><span class="result__snippet">no title, no url</span></div>
            <div class="result"><a class="result__a">title but no href</a></div>
        "#;
        let items = parse_duckduckgo_results(html, 10);
        assert!(items.is_empty());
    }

    #[test]
    fn blocked_page_is_an_error_not_empty_results() {
        let anomaly_page = r#"
            <html><body>
              <div class="anomaly">Anomaly detected, please try again later</div>
              <form class="frm-challenge">captcha</form>
            </body></html>
        "#;
        let result = parse_search_response(anomaly_page, 5, parse_duckduckgo_results);
        assert!(
            matches!(result, Err(BrowserError::EngineBlocked)),
            "blocked page must surface as EngineBlocked, got {result:?}"
        );
    }

    #[test]
    fn legitimate_empty_page_is_ok() {
        let empty_page = r#"<html><body><div id="links"></div></body></html>"#;
        let result = parse_search_response(empty_page, 5, parse_duckduckgo_results);
        assert!(matches!(result, Ok(items) if items.is_empty()));
    }

    const LITE_FIXTURE: &str = r#"
        <html><body>
          <div id="links">
            <table class="results">
              <tr class="result" id="r1-0">
                <td class="result-snippet">Lite snippet for result one.</td>
              </tr>
              <tr id="r1-1">
                <td class="result-link">
                  <a rel="nofollow" class="result-link" href="https://example.com/lite-one">Lite Result One</a>
                  <span class="link-text">example.com</span>
                </td>
              </tr>
            </table>
            <table class="results">
              <tr class="result" id="r2-0">
                <td class="result-snippet">Second snippet.</td>
              </tr>
              <tr id="r2-1">
                <td class="result-link">
                  <a rel="nofollow" class="result-link" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Flite-two&amp;rut=zz">Lite Result Two</a>
                </td>
              </tr>
            </table>
          </div>
        </body></html>
    "#;

    #[test]
    fn parses_lite_results_with_direct_and_uddg_urls() {
        let items = parse_lite_results(LITE_FIXTURE, 10);
        assert_eq!(items.len(), 2);

        assert_eq!(items[0].title, "Lite Result One");
        assert_eq!(items[0].url, "https://example.com/lite-one");
        assert_eq!(items[0].snippet, "Lite snippet for result one.");

        // uddg= redirects are decoded the same way as in the html UI.
        assert_eq!(items[1].title, "Lite Result Two");
        assert_eq!(items[1].url, "https://example.org/lite-two");
        assert_eq!(items[1].snippet, "Second snippet.");
    }

    #[test]
    fn lite_parser_respects_max_results() {
        let items = parse_lite_results(LITE_FIXTURE, 1);
        assert_eq!(items.len(), 1);
    }

    #[test]
    fn lite_blocked_page_surfaces_as_engine_blocked() {
        let blocked = r#"
            <html><body><form id="challenge">captcha puzzle</form></body></html>
        "#;
        let result = parse_search_response(blocked, 5, parse_lite_results);
        assert!(
            matches!(result, Err(BrowserError::EngineBlocked)),
            "blocked lite page must surface as EngineBlocked, got {result:?}"
        );
    }

    #[test]
    fn engine_block_cooldown_window() {
        let now = Instant::now();
        assert!(in_cooldown(Some(now), now));
        assert!(in_cooldown(Some(now - Duration::from_secs(10)), now));
        assert!(!in_cooldown(
            Some(now - ENGINE_BLOCK_COOLDOWN - Duration::from_secs(1)),
            now
        ));
        assert!(!in_cooldown(None, now));
    }

    #[test]
    fn mark_and_check_cooldown_round_trip() {
        assert!(!engine_blocked_cooldown_active());
        mark_engine_blocked();
        assert!(engine_blocked_cooldown_active());
        // Reset the shared state so other tests stay deterministic.
        if let Ok(mut guard) = LAST_ENGINE_BLOCK.lock() {
            *guard = None;
        }
    }

    #[test]
    fn query_clamping_rules() {
        assert_eq!((0usize).clamp(1, MAX_RESULTS_LIMIT), 1);
        assert_eq!((10usize).clamp(1, MAX_RESULTS_LIMIT), 10);
        assert_eq!((100usize).clamp(1, MAX_RESULTS_LIMIT), MAX_RESULTS_LIMIT);
        assert_eq!((3usize).clamp(1, MAX_RESULTS_LIMIT), 3);
    }
}
