// ─── Browser Security: SSRF Protection ───────────────────────────────────────
// Centralized network validation used by web_fetch and web_search.
// The Rust backend is the single authority for URL/network restrictions;
// TypeScript must not duplicate this logic.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::str::FromStr;
use std::time::Duration;
use url::Url;

/// DNS lookups must never hang the browser commands: if the resolver does not
/// answer in time the request fails as a resolution error instead.
const DNS_RESOLVE_TIMEOUT: Duration = Duration::from_secs(3);

// ─── Structured Browser Errors ───────────────────────────────────────────────

#[derive(Debug, thiserror::Error)]
pub enum BrowserError {
    #[error("Invalid URL format: {0}")]
    InvalidUrl(String),
    #[error("Only http and https URLs are allowed.")]
    UnsupportedScheme,
    #[error("Fetching internal/private addresses is not allowed ({0}).")]
    PrivateAddress(String),
    #[error("Could not resolve hostname: {0}")]
    DnsResolution(String),
    #[error("Request failed: {0}")]
    Network(String),
    #[error("The search engine blocked the request (CAPTCHA/anomaly detected) and is cooling down for ~45s. Do not retry the same query immediately — wait, then rephrase it, or use web_fetch on a known URL instead.")]
    EngineBlocked,
    #[error("HTTP {status} error fetching {url}")]
    HttpStatus { status: u16, url: String },
    #[error("Too many redirects (max {0}).")]
    RedirectLimit(u8),
    #[error("Redirect target blocked: {0}")]
    InvalidRedirect(String),
    #[error("Query cannot be empty.")]
    EmptyQuery,
}

impl BrowserError {
    /// Stable machine-readable code, formatted as a "[code]" prefix so clients
    /// (harness tool handlers, UI) can branch on the failure class.
    pub fn code(&self) -> &'static str {
        match self {
            BrowserError::InvalidUrl(_) => "invalid_url",
            BrowserError::UnsupportedScheme => "unsupported_scheme",
            BrowserError::PrivateAddress(_) => "private_address",
            BrowserError::DnsResolution(_) => "dns_resolution",
            BrowserError::Network(_) => "network",
            BrowserError::EngineBlocked => "engine_blocked",
            BrowserError::HttpStatus { .. } => "http_status",
            BrowserError::RedirectLimit(_) => "redirect_limit",
            BrowserError::InvalidRedirect(_) => "invalid_redirect",
            BrowserError::EmptyQuery => "empty_query",
        }
    }

    /// Formats the error with the machine-readable prefix for Tauri clients.
    pub fn message(&self) -> String {
        format!("[{}] {}", self.code(), self)
    }
}

// ─── Private / Internal Address Detection ────────────────────────────────────
// Fail closed: any address that is loopback, private, link-local, ULA,
// documentation, multicast or reserved is treated as unreachable.

fn is_private_ipv4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    match (a, b, c) {
        // 0.0.0.0/8 "this network"
        (0, _, _) => true,
        // 10.0.0.0/8 (RFC 1918)
        (10, _, _) => true,
        // 100.64.0.0/10 CGNAT (RFC 6598)
        (100, 64..=127, _) => true,
        // 127.0.0.0/8 loopback
        (127, _, _) => true,
        // 169.254.0.0/16 link-local (RFC 3927)
        (169, 254, _) => true,
        // 172.16.0.0/12 (RFC 1918)
        (172, 16..=31, _) => true,
        // 192.0.0.0/24 (IETF protocol assignments) + 192.0.2.0/24 (TEST-NET-1)
        (192, 0, 0) | (192, 0, 2) => true,
        // 192.88.99.0/24 (deprecated 6to4 relay anycast)
        (192, 88, 99) => true,
        // 192.168.0.0/16 (RFC 1918)
        (192, 168, _) => true,
        // 198.18.0.0/15 benchmarking (RFC 2544) + 198.51.100.0/24 (TEST-NET-2)
        (198, 18..=19, _) | (198, 51, 100) => true,
        // 203.0.113.0/24 (TEST-NET-3)
        (203, 0, 113) => true,
        // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved (incl. broadcast)
        (224..=239, _, _) | (240..=255, _, _) => true,
        _ => false,
    }
}

fn is_private_ipv6(ip: Ipv6Addr) -> bool {
    // IPv4-mapped IPv6 (::ffff:0:0/96): check the embedded IPv4 address.
    if let Some(v4) = ip.to_ipv4_mapped() {
        return is_private_ipv4(v4);
    }
    let seg = ip.segments();
    match seg {
        // :: and ::1
        [0, 0, 0, 0, 0, 0, 0, 0] | [0, 0, 0, 0, 0, 0, 0, 1] => true,
        // 2001:db8::/32 documentation (RFC 3849)
        [0x2001, 0x0db8, ..] => true,
        // fc00::/7 unique local (RFC 4193)
        [0xfc00..=0xfdff, ..] => true,
        // fe80::/10 link-local
        [0xfe80..=0xfebf, ..] => true,
        // ff00::/8 multicast
        [0xff00..=0xffff, ..] => true,
        _ => false,
    }
}

pub fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_private_ipv4(v4),
        IpAddr::V6(v6) => is_private_ipv6(v6),
    }
}

/// Validates that a URL is fetchable by the browser tools:
/// http/https scheme only, and the target must resolve to public addresses.
/// Hostnames are DNS-resolved and every resolved address is checked, which
/// closes the literal-IP bypasses (hex/octal, IPv4-mapped, trailing dot).
pub async fn validate_http_url(raw: &str) -> Result<Url, BrowserError> {
    let parsed = Url::parse(raw).map_err(|e| BrowserError::InvalidUrl(e.to_string()))?;

    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(BrowserError::UnsupportedScheme);
    }

    let host = parsed
        .host_str()
        .ok_or_else(|| BrowserError::InvalidUrl("URL has no host".to_string()))?;

    // Literal IP (handles IPv4, IPv6 and IPv4-mapped IPv6 forms).
    if let Ok(ip) = IpAddr::from_str(host) {
        if is_private_ip(ip) {
            return Err(BrowserError::PrivateAddress(host.to_string()));
        }
        return Ok(parsed);
    }

    // Hostname forms of localhost (trailing dot included) — reject before DNS.
    let lower_host = host.to_lowercase();
    let base = lower_host.trim_end_matches('.');
    if base == "localhost" {
        return Err(BrowserError::PrivateAddress(host.to_string()));
    }

    // Resolve and validate every address the hostname maps to. Failing closed
    // on resolution errors prevents DNS-rebinding style surprises; the timeout
    // guarantees a stuck resolver cannot stall the command.
    let port = parsed.port_or_known_default().unwrap_or(443);
    let lookup = tokio::time::timeout(DNS_RESOLVE_TIMEOUT, tokio::net::lookup_host((host, port)))
        .await
        .map_err(|_| BrowserError::DnsResolution(format!("DNS lookup timed out for {host}")))?
        .map_err(|e| BrowserError::DnsResolution(format!("{host}: {e}")))?;

    let mut any_public = false;
    for addr in lookup {
        let ip = addr.ip();
        if is_private_ip(ip) {
            return Err(BrowserError::PrivateAddress(format!(
                "{host} resolves to {ip}"
            )));
        }
        any_public = true;
    }
    if !any_public {
        return Err(BrowserError::DnsResolution(format!(
            "no addresses for {host}"
        )));
    }

    Ok(parsed)
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

    fn v4(a: u8, b: u8, c: u8, d: u8) -> IpAddr {
        IpAddr::V4(Ipv4Addr::new(a, b, c, d))
    }

    fn v6(segments: [u16; 8]) -> IpAddr {
        IpAddr::V6(Ipv6Addr::from(segments))
    }

    #[test]
    fn private_ipv4_ranges_are_blocked() {
        for ip in [
            v4(0, 0, 0, 0),
            v4(10, 0, 0, 1),
            v4(10, 255, 255, 255),
            v4(100, 64, 0, 1),
            v4(100, 127, 255, 255),
            v4(127, 0, 0, 1),
            v4(127, 255, 255, 255),
            v4(169, 254, 0, 1),
            v4(172, 16, 0, 1),
            v4(172, 31, 255, 255),
            v4(192, 0, 2, 1),
            v4(192, 88, 99, 1),
            v4(192, 168, 0, 1),
            v4(192, 168, 255, 254),
            v4(198, 18, 0, 1),
            v4(198, 19, 255, 255),
            v4(198, 51, 100, 1),
            v4(203, 0, 113, 1),
            v4(224, 0, 0, 1),
            v4(239, 255, 255, 255),
            v4(240, 0, 0, 1),
            v4(255, 255, 255, 255),
        ] {
            assert!(is_private_ip(ip), "{ip} should be private");
        }
    }

    #[test]
    fn public_ipv4_ranges_are_allowed() {
        for ip in [
            v4(8, 8, 8, 8),
            v4(1, 1, 1, 1),
            v4(93, 184, 216, 34),
            v4(100, 63, 0, 1),
            v4(100, 128, 0, 1),
            v4(172, 15, 0, 1),
            v4(172, 32, 0, 1),
            v4(192, 0, 1, 1),
            v4(192, 88, 100, 1),
            v4(198, 20, 0, 1),
            v4(198, 51, 101, 1),
            v4(203, 0, 114, 1),
            v4(203, 113, 0, 1),
        ] {
            assert!(!is_private_ip(ip), "{ip} should be public");
        }
    }

    #[test]
    fn private_ipv6_ranges_are_blocked() {
        for ip in [
            v6([0, 0, 0, 0, 0, 0, 0, 0]),
            v6([0, 0, 0, 0, 0, 0, 0, 1]),
            v6([0xfc00, 0, 0, 0, 0, 0, 0, 1]),
            v6([
                0xfdff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff,
            ]),
            v6([0xfe80, 0, 0, 0, 0, 0, 0, 1]),
            v6([
                0xfebf, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff,
            ]),
            v6([0xff00, 0, 0, 0, 0, 0, 0, 1]),
            v6([
                0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff,
            ]),
            v6([0x2001, 0x0db8, 0, 0, 0, 0, 0, 1]),
        ] {
            assert!(is_private_ip(ip), "{ip} should be private");
        }
    }

    #[test]
    fn ipv4_mapped_ipv6_inherits_ipv4_ranges() {
        // ::ffff:127.0.0.1 (loopback) and ::ffff:10.0.0.1 (RFC 1918) must be blocked
        let loopback_mapped = IpAddr::V6(Ipv6Addr::new(0, 0, 0, 0, 0, 0xffff, 0x7f00, 0x0001));
        assert!(is_private_ip(loopback_mapped));
        let rfc1918_mapped = IpAddr::V6(Ipv6Addr::new(0, 0, 0, 0, 0, 0xffff, 0x0a00, 0x0001));
        assert!(is_private_ip(rfc1918_mapped));
        // ::ffff:8.8.8.8 is public
        let public_mapped = IpAddr::V6(Ipv6Addr::new(0, 0, 0, 0, 0, 0xffff, 0x0808, 0x0808));
        assert!(!is_private_ip(public_mapped));
    }

    #[test]
    fn url_validation_blocks_private_literals() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("failed to build test runtime");

        for url in [
            "http://127.0.0.1/",
            "http://127.0.0.1:8080/status",
            "http://10.1.2.3/x",
            "http://172.16.0.1/",
            "http://192.168.1.1/",
            "http://169.254.169.254/latest/meta-data/",
            "http://[::1]/",
            "http://[::ffff:127.0.0.1]/",
            "http://localhost/",
            "http://localhost./",
        ] {
            let result = rt.block_on(validate_http_url(url));
            assert!(
                matches!(result, Err(BrowserError::PrivateAddress(_))),
                "{url} should be rejected as private, got {result:?}"
            );
        }
    }

    #[test]
    fn url_validation_rejects_bad_schemes() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("failed to build test runtime");

        for url in [
            "file:///etc/passwd",
            "ftp://example.com/file",
            "data:text/plain,x",
        ] {
            let result = rt.block_on(validate_http_url(url));
            assert!(
                matches!(result, Err(BrowserError::UnsupportedScheme)),
                "{url} should be rejected as unsupported scheme, got {result:?}"
            );
        }
    }

    #[test]
    fn url_validation_rejects_garbage() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("failed to build test runtime");

        // Any non-fetchable input must be rejected (invalid syntax or a
        // hostname that cannot be resolved).
        for url in ["not a url", "http://", "http:///path"] {
            let result = rt.block_on(validate_http_url(url));
            assert!(
                matches!(
                    result,
                    Err(BrowserError::InvalidUrl(_)) | Err(BrowserError::DnsResolution(_))
                ),
                "{url:?} should be rejected, got {result:?}"
            );
        }
    }
}
