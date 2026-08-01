use ego_tree::NodeRef;
use scraper::{Html, Node, Selector};
use serde::Serialize;
use std::time::Duration;

use super::security::{validate_http_url, BrowserError};

// ─── Shared HTTP Client ──────────────────────────────────────────────────────
// One client builder for every browser command: consistent UA, timeout and
// redirect policy. Redirects are handled manually so every hop can be
// re-validated against the SSRF policy (automatic following could redirect
// a public URL into a private address).

pub const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36 HysCode-Agent";

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_REDIRECTS: u8 = 5;
/// Hard cap on downloaded body bytes, enforced while streaming, before any
/// text extraction or truncation happens.
const MAX_DOWNLOAD_BYTES: usize = 2 * 1024 * 1024;

pub(crate) fn shared_client() -> Result<reqwest::Client, BrowserError> {
    reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .user_agent(USER_AGENT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| BrowserError::Network(e.to_string()))
}

// ─── Web Fetch ──────────────────────────────────────────────────────────────
// Tauri matches invoke payload keys to parameter names (camelCased), so
// optional arguments are plain `Option` parameters — a single struct param
// would force the client to wrap the payload in `{ args: {...} }`.

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
pub async fn web_fetch(
    url: String,
    max_length: Option<usize>,
    include_metadata: Option<bool>,
) -> Result<WebFetchResult, String> {
    run_web_fetch(
        url,
        max_length.unwrap_or(10000),
        include_metadata.unwrap_or(true),
    )
    .await
    .map_err(|e| e.message())
}

async fn run_web_fetch(
    url: String,
    requested_max_length: usize,
    include_metadata: bool,
) -> Result<WebFetchResult, BrowserError> {
    // Defense in depth: clamp the requested text length before use.
    let max_length = requested_max_length.clamp(100, 100_000);

    let client = shared_client()?;
    let mut current = validate_http_url(&url).await?;

    for hop in 0..=MAX_REDIRECTS {
        let mut resp = client
            .get(current.clone())
            .send()
            .await
            .map_err(|e| BrowserError::Network(format!("GET {current}: {e}")))?;

        let status = resp.status().as_u16();
        let content_type = resp
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());

        // Manual redirect handling: re-validate every hop URL.
        if let Some(location) = resp.headers().get("location").and_then(|v| v.to_str().ok()) {
            if hop >= MAX_REDIRECTS {
                return Err(BrowserError::RedirectLimit(MAX_REDIRECTS));
            }
            let next = current
                .join(location)
                .map_err(|e| BrowserError::InvalidRedirect(format!("{location}: {e}")))?;
            current = validate_http_url(next.as_str()).await?;
            continue;
        }

        let final_url = current;

        // HTTP errors are failures, not content.
        if !(200..300).contains(&status) {
            return Err(BrowserError::HttpStatus {
                status,
                url: final_url.to_string(),
            });
        }

        // Stream the body with a hard cap so huge pages can't exhaust memory.
        let mut body: Vec<u8> = Vec::new();
        let mut body_truncated = false;
        while let Some(chunk) = resp
            .chunk()
            .await
            .map_err(|e| BrowserError::Network(e.to_string()))?
        {
            body.extend_from_slice(&chunk);
            if body.len() > MAX_DOWNLOAD_BYTES {
                body.truncate(MAX_DOWNLOAD_BYTES);
                body_truncated = true;
                break;
            }
        }
        let raw = String::from_utf8_lossy(&body);

        // HTML responses get readable-text extraction; everything else
        // (JSON, plain text, XML...) is passed through verbatim.
        let is_html = content_type
            .as_deref()
            .map(|ct| ct.contains("html"))
            .unwrap_or(true);
        let extracted = if is_html {
            extract_readable_text(&raw)
        } else {
            ExtractedText {
                title: None,
                text: raw.to_string(),
            }
        };

        let mut text = extracted.text;
        let truncated = body_truncated || text.len() > max_length;
        if text.len() > max_length {
            // Cut at a UTF-8 character boundary.
            let mut cut = max_length;
            while cut > 0 && !text.is_char_boundary(cut) {
                cut -= 1;
            }
            text.truncate(cut);
            text.push_str(
                "\n\n[… truncated — use web_fetch again with higher max_length to read more]",
            );
        }

        let text_len = text.len();

        return Ok(WebFetchResult {
            title: extracted.title,
            url: final_url.to_string(),
            text,
            length: text_len,
            truncated,
            metadata: if include_metadata {
                Some(WebFetchMetadata {
                    content_type,
                    status,
                })
            } else {
                None
            },
        });
    }

    Err(BrowserError::RedirectLimit(MAX_REDIRECTS))
}

// ─── Readable Text Extraction ────────────────────────────────────────────────
// Single pass over the parsed tree: unwanted subtrees are skipped and
// block-level elements produce line breaks. No string-replacement tricks,
// so large documents are handled in O(n) with no risk of mangling content.

struct ExtractedText {
    title: Option<String>,
    text: String,
}

const SKIP_TAGS: [&str; 8] = [
    "script", "style", "nav", "header", "footer", "aside", "noscript", "iframe",
];

const BLOCK_TAGS: [&str; 25] = [
    "p",
    "div",
    "section",
    "article",
    "main",
    "header",
    "footer",
    "nav",
    "aside",
    "li",
    "ul",
    "ol",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "pre",
    "blockquote",
    "table",
    "tr",
    "br",
    "hr",
    "form",
];

fn extract_readable_text(html: &str) -> ExtractedText {
    let document = Html::parse_document(html);

    let title = Selector::parse("title")
        .ok()
        .and_then(|sel| document.select(&sel).next())
        .map(|e| e.text().collect::<String>().trim().to_string())
        .filter(|t| !t.is_empty());

    // Prefer <main>, then <article>, then <body>.
    let root = Selector::parse("main")
        .ok()
        .and_then(|sel| document.select(&sel).next())
        .or_else(|| {
            Selector::parse("article")
                .ok()
                .and_then(|sel| document.select(&sel).next())
        })
        .or_else(|| {
            Selector::parse("body")
                .ok()
                .and_then(|sel| document.select(&sel).next())
        });

    let mut parts: Vec<String> = Vec::new();
    if let Some(root_el) = root {
        collect_readable_text(*root_el, &mut parts);
    }

    let text = parts
        .join("")
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join("\n");

    ExtractedText { title, text }
}

fn collect_readable_text<'a>(node: NodeRef<'a, Node>, out: &mut Vec<String>) {
    for child in node.children() {
        match child.value() {
            Node::Element(el) => {
                let name = el.name();
                if SKIP_TAGS.contains(&name) {
                    continue;
                }
                if BLOCK_TAGS.contains(&name) {
                    out.push("\n".to_string());
                }
                collect_readable_text(child, out);
            }
            Node::Text(t) => out.push(t.text.to_string()),
            _ => {}
        }
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn extract(html: &str) -> String {
        extract_readable_text(html).text
    }

    #[test]
    fn strips_scripts_styles_and_navigation() {
        let html = r#"
            <html><head>
              <title>Page Title</title>
              <script>var secret = "x";</script>
              <style>body { color: red; }</style>
            </head><body>
              <nav><a href="/">Home</a><a href="/about">About</a></nav>
              <header>Site header</header>
              <main>
                <p>Hello world.</p>
                <p>Second paragraph.</p>
              </main>
              <footer>Footer text</footer>
            </body></html>
        "#;
        let result = extract_readable_text(html);
        assert_eq!(result.title.as_deref(), Some("Page Title"));
        assert_eq!(result.text, "Hello world.\nSecond paragraph.");
        assert!(!result.text.contains("secret"));
        assert!(!result.text.contains("Home"));
        assert!(!result.text.contains("Footer"));
    }

    #[test]
    fn falls_back_to_article_then_body() {
        let article_only =
            r#"<html><body><article><p>A</p><p>B</p></article><p>C</p></body></html>"#;
        assert_eq!(extract(article_only), "A\nB");

        let body_only = r#"<html><body><div>Alpha</div><div>Beta</div></body></html>"#;
        assert_eq!(extract(body_only), "Alpha\nBeta");
    }

    #[test]
    fn keeps_inline_text_together() {
        let html = r#"<html><body><p>Hello <b>bold</b> world!</p></body></html>"#;
        assert_eq!(extract(html), "Hello bold world!");
    }

    #[test]
    fn plain_text_without_markup_is_preserved() {
        let html = r#"<html><body>{"status":"ok","count":3}</body></html>"#;
        assert_eq!(extract(html), r#"{"status":"ok","count":3}"#);
    }

    #[test]
    fn empty_document_yields_empty_text() {
        assert_eq!(extract(""), "");
    }
}
