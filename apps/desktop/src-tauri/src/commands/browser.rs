use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};

// ─── SSRF / Private Host Protection ───────────────────────────────────────────

fn is_private_host(hostname: &str) -> bool {
    let host_lower = hostname.to_lowercase();

    // localhost variants
    if host_lower == "localhost"
        || host_lower.starts_with("localhost.")
        || host_lower.ends_with(".localhost")
    {
        return true;
    }

    // IPv4 private ranges
    let ipv4_parts: Vec<&str> = host_lower.split('.').collect();
    if ipv4_parts.len() == 4 {
        if let (Ok(a), Ok(b), Ok(c), Ok(d)) = (
            ipv4_parts[0].parse::<u8>(),
            ipv4_parts[1].parse::<u8>(),
            ipv4_parts[2].parse::<u8>(),
            ipv4_parts[3].parse::<u8>(),
        ) {
            // 10.0.0.0/8
            if a == 10 {
                return true;
            }
            // 172.16.0.0/12
            if a == 172 && (16..=31).contains(&b) {
                return true;
            }
            // 192.168.0.0/16
            if a == 192 && b == 168 {
                return true;
            }
            // 127.0.0.0/8 (loopback)
            if a == 127 {
                return true;
            }
            // 169.254.0.0/16 (link-local)
            if a == 169 && b == 254 {
                return true;
            }
            // 0.0.0.0
            if a == 0 && b == 0 && c == 0 && d == 0 {
                return true;
            }
        }
    }

    // IPv6 loopback / private
    if host_lower == "::1" || host_lower == "0:0:0:0:0:0:0:1" {
        return true;
    }
    if host_lower.starts_with("fc") || host_lower.starts_with("fd") {
        return true; // unique local
    }
    if host_lower.starts_with("fe80:") {
        return true; // link-local
    }

    false
}

fn validate_url(url: &str) -> Result<url::Url, String> {
    let parsed = url::Url::parse(url).map_err(|_| "Invalid URL format.".to_string())?;

    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("Only http and https URLs are allowed.".to_string());
    }

    if is_private_host(parsed.host_str().unwrap_or("")) {
        return Err("Fetching internal/private addresses is not allowed.".to_string());
    }

    Ok(parsed)
}

// ─── Web Fetch ──────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct WebFetchArgs {
    url: String,
    #[serde(default = "default_max_length")]
    max_length: usize,
    #[serde(default = "default_include_metadata")]
    include_metadata: bool,
}

fn default_max_length() -> usize {
    10000
}

fn default_include_metadata() -> bool {
    true
}

#[derive(Debug, Serialize)]
pub struct WebFetchResult {
    title: Option<String>,
    url: String,
    text: String,
    length: usize,
    truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    metadata: Option<WebFetchMetadata>,
}

#[derive(Debug, Serialize)]
pub struct WebFetchMetadata {
    content_type: Option<String>,
    status: u16,
}

#[tauri::command]
pub async fn web_fetch(args: WebFetchArgs) -> Result<WebFetchResult, String> {
    let parsed = validate_url(&args.url)?;
    let url_str = parsed.as_str().to_string();

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36 HysCode-Agent"
        )
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let resp = client
        .get(&url_str)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let status = resp.status();
    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let body = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    // Extract readable text from HTML
    let extracted = extract_readable_text(&body, &url_str);

    let mut text = extracted.text;
    let truncated = text.len() > args.max_length;
    if truncated {
        // Try to cut at a word boundary
        let mut cut = args.max_length;
        while cut > 0 && !text.is_char_boundary(cut) {
            cut -= 1;
        }
        text.truncate(cut);
        text.push_str(
            "\n\n[… truncated — use web_fetch again with higher max_length to read more]",
        );
    }

    let text_len = text.len();

    Ok(WebFetchResult {
        title: extracted.title,
        url: url_str,
        text,
        length: text_len,
        truncated,
        metadata: if args.include_metadata {
            Some(WebFetchMetadata {
                content_type,
                status: status.as_u16(),
            })
        } else {
            None
        },
    })
}

struct ExtractedText {
    title: Option<String>,
    text: String,
}

fn extract_readable_text(html: &str, _url: &str) -> ExtractedText {
    let document = Html::parse_document(html);

    // Extract title
    let title = document
        .select(&Selector::parse("title").unwrap())
        .next()
        .map(|e| e.text().collect::<String>().trim().to_string())
        .filter(|t| !t.is_empty());

    // Remove script/style/nav/header/footer/aside tags
    let mut cleaned_html = html.to_string();
    for tag in [
        "script", "style", "nav", "header", "footer", "aside", "noscript",
    ] {
        let selector = match Selector::parse(tag) {
            Ok(s) => s,
            Err(_) => continue,
        };
        for element in document.select(&selector) {
            let outer = element.html();
            cleaned_html = cleaned_html.replace(&outer, " ");
        }
    }

    // Re-parse after cleaning
    let cleaned_doc = Html::parse_document(&cleaned_html);

    // Try main/article/main content first, fallback to body
    let mut text_parts: Vec<String> = Vec::new();

    if let Some(main) = cleaned_doc.select(&Selector::parse("main").unwrap()).next() {
        text_parts.push(extract_text_from_element(&main));
    } else if let Some(article) = cleaned_doc
        .select(&Selector::parse("article").unwrap())
        .next()
    {
        text_parts.push(extract_text_from_element(&article));
    } else if let Some(body) = cleaned_doc.select(&Selector::parse("body").unwrap()).next() {
        text_parts.push(extract_text_from_element(&body));
    }

    let text = text_parts
        .join("\n\n")
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join("\n");

    ExtractedText { title, text }
}

fn extract_text_from_element(element: &scraper::ElementRef) -> String {
    element
        .text()
        .collect::<Vec<_>>()
        .join(" ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

// ─── Web Search ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct WebSearchArgs {
    query: String,
    #[serde(default = "default_search_results")]
    max_results: usize,
}

fn default_search_results() -> usize {
    5
}

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

#[tauri::command]
pub async fn web_search(args: WebSearchArgs) -> Result<WebSearchResult, String> {
    let query = args.query.trim();
    if query.is_empty() {
        return Err("Query cannot be empty.".to_string());
    }

    // Use DuckDuckGo HTML search (no API key required)
    let encoded = urlencoding::encode(query);
    let search_url = format!("https://html.duckduckgo.com/html/?q={}", encoded);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36"
        )
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let resp = client
        .get(&search_url)
        .send()
        .await
        .map_err(|e| format!("Search request failed: {}", e))?;

    let status = resp.status();
    if !status.is_success() {
        return Err(format!("Search engine returned HTTP {}", status.as_u16()));
    }

    let html = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read search response: {}", e))?;

    let results = parse_duckduckgo_results(&html, args.max_results);

    Ok(WebSearchResult {
        query: query.to_string(),
        results,
    })
}

fn parse_duckduckgo_results(html: &str, max_results: usize) -> Vec<SearchResultItem> {
    let document = Html::parse_document(html);
    let result_selector = Selector::parse(".result").unwrap();
    let title_selector = Selector::parse(".result__a").unwrap();
    let snippet_selector = Selector::parse(".result__snippet").unwrap();
    let url_selector = Selector::parse(".result__url").unwrap();

    let mut items = Vec::new();

    for result in document.select(&result_selector).take(max_results) {
        let title = result
            .select(&title_selector)
            .next()
            .map(|e| e.text().collect::<String>().trim().to_string())
            .unwrap_or_default();

        let snippet = result
            .select(&snippet_selector)
            .next()
            .map(|e| e.text().collect::<String>().trim().to_string())
            .unwrap_or_default();

        let url = result
            .select(&url_selector)
            .next()
            .map(|e| e.text().collect::<String>().trim().to_string())
            .unwrap_or_default();

        // Fallback: extract href from title link
        let url = if url.is_empty() {
            result
                .select(&title_selector)
                .next()
                .and_then(|e| e.value().attr("href"))
                .map(|s| {
                    // DuckDuckGo redirects through //duckduckgo.com/l/?uddg=
                    if let Some(pos) = s.find("uddg=") {
                        urlencoding::decode(&s[pos + 5..])
                            .map(|d| d.to_string())
                            .unwrap_or_else(|_| s.to_string())
                    } else {
                        s.to_string()
                    }
                })
                .unwrap_or_default()
        } else {
            url
        };

        if !title.is_empty() && !url.is_empty() {
            items.push(SearchResultItem {
                title,
                url,
                snippet,
            });
        }
    }

    items
}
