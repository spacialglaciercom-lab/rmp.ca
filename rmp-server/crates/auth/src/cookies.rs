/// Cookie handling utilities ported from server/_core/cookies.ts

use axum::http::HeaderMap;

const LOCAL_HOSTS: &[&str] = &["localhost", "127.0.0.1", "::1"];

/// Check if a hostname is an IP address.
fn is_ip_address(host: &str) -> bool {
    // Basic IPv4 check
    if host.split('.').all(|p| p.parse::<u8>().is_ok()) && host.matches('.').count() == 3 {
        return true;
    }
    // IPv6 detection
    host.contains(':')
}

/// Check if the request was made over HTTPS (directly or via proxy).
pub fn is_secure_request(headers: &HeaderMap) -> bool {
    // Check x-forwarded-proto header (common for reverse proxies)
    if let Some(forwarded) = headers.get("x-forwarded-proto") {
        if let Ok(val) = forwarded.to_str() {
            let protos: Vec<String> = val.split(',').map(|s| s.trim().to_lowercase()).collect();
            if protos.iter().any(|p| p.as_str() == "https") {
                return true;
            }
        }
    }
    false
}

/// Extract parent domain for cross-subdomain cookie sharing.
/// e.g., "3000-xxx.manuspre.computer" -> ".manuspre.computer"
pub fn get_parent_domain(hostname: &str) -> Option<String> {
    // Don't set domain for localhost or IP addresses
    if LOCAL_HOSTS.contains(&hostname) || is_ip_address(hostname) {
        return None;
    }

    let parts: Vec<&str> = hostname.split('.').collect();

    // Need at least 3 parts for a subdomain
    if parts.len() < 3 {
        return None;
    }

    // Return parent domain with leading dot
    Some(format!(".{}.{}", parts[parts.len() - 2], parts[parts.len() - 1]))
}

/// Cookie options for session cookies, matching Node.js getSessionCookieOptions().
pub struct SessionCookieOptions {
    pub domain: Option<String>,
    pub http_only: bool,
    pub path: &'static str,
    pub same_site: &'static str,
    pub secure: bool,
}

/// Get session cookie options for the current request.
pub fn get_session_cookie_options(hostname: &str, headers: &HeaderMap) -> SessionCookieOptions {
    SessionCookieOptions {
        domain: get_parent_domain(hostname),
        http_only: true,
        path: "/",
        same_site: "none",
        secure: is_secure_request(headers),
    }
}

/// Build a Set-Cookie header value for a session token.
pub fn build_session_cookie(
    token: &str,
    hostname: &str,
    headers: &HeaderMap,
    max_age_secs: i64,
) -> String {
    let opts = get_session_cookie_options(hostname, headers);
    let mut cookie = format!(
        "app_session_id={}; HttpOnly; Path={}; SameSite={}",
        token, opts.path, opts.same_site
    );
    if opts.secure {
        cookie.push_str("; Secure");
    }
    if let Some(domain) = opts.domain {
        cookie.push_str(&format!("; Domain={}", domain));
    }
    cookie.push_str(&format!("; Max-Age={}", max_age_secs));
    cookie
}
