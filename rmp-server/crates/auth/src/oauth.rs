use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use tracing::{debug, warn};

use rmp_db::models::{get_user_by_open_id, upsert_user};
use rmp_db::schema::User;
use rmp_shared::config::Config;

use crate::session;

// ── Manus OAuth types (matching manusTypes.ts) ────────────────────────────

#[derive(Debug, Serialize)]
struct ExchangeTokenRequest {
    #[serde(rename = "grantType")]
    grant_type: String,
    code: String,
    #[serde(rename = "clientId")]
    client_id: String,
    #[serde(rename = "redirectUri")]
    redirect_uri: String,
}

#[derive(Debug, Deserialize)]
struct ExchangeTokenResponse {
    #[serde(rename = "accessToken")]
    access_token: String,
    // Other fields present but unused: token_type, expires_in, refresh_token, scope, id_token
}

#[derive(Debug, Deserialize)]
struct GetUserInfoResponse {
    #[serde(rename = "openId")]
    open_id: String,
    name: String,
    email: Option<String>,
    platform: Option<String>,
    #[serde(rename = "loginMethod")]
    login_method: Option<String>,
    platforms: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
struct GetUserInfoWithJwtRequest {
    #[serde(rename = "jwtToken")]
    jwt_token: String,
    #[serde(rename = "projectId")]
    project_id: String,
}

#[derive(Debug, Deserialize)]
struct GetUserInfoWithJwtResponse {
    #[serde(rename = "openId")]
    open_id: String,
    name: String,
    email: Option<String>,
    platform: Option<String>,
    #[serde(rename = "loginMethod")]
    login_method: Option<String>,
    platforms: Option<Vec<String>>,
}

// ── OAuth client ──────────────────────────────────────────────────────────

const EXCHANGE_TOKEN_PATH: &str = "/webdev.v1.WebDevAuthPublicService/ExchangeToken";
const GET_USER_INFO_PATH: &str = "/webdev.v1.WebDevAuthPublicService/GetUserInfo";
const GET_USER_INFO_WITH_JWT_PATH: &str = "/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt";

/// Manus OAuth client for code exchange and user info retrieval.
pub struct OAuthClient {
    http: reqwest::Client,
    base_url: String,
    app_id: String,
}

impl OAuthClient {
    pub fn new(config: &Config) -> Self {
        Self {
            http: reqwest::Client::new(),
            base_url: config.oauth_server_url.clone(),
            app_id: config.app_id.clone(),
        }
    }

    /// Decode the base64-encoded state parameter to get the redirect URI.
    fn decode_state(&self, state: &str) -> String {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD
            .decode(state)
            .map(|b| String::from_utf8_lossy(&b).to_string())
            .unwrap_or_else(|_| state.to_string())
    }

    /// Exchange an OAuth authorization code for an access token.
    pub async fn exchange_code_for_token(
        &self,
        code: &str,
        state: &str,
    ) -> Result<ExchangeTokenResponse, reqwest::Error> {
        let redirect_uri = self.decode_state(state);
        let payload = ExchangeTokenRequest {
            grant_type: "authorization_code".to_string(),
            code: code.to_string(),
            client_id: self.app_id.clone(),
            redirect_uri,
        };

        let url = format!("{}{}", self.base_url, EXCHANGE_TOKEN_PATH);
        let resp = self.http.post(&url).json(&payload).send().await?;
        resp.json().await
    }

    /// Get user info using an access token.
    pub async fn get_user_info(
        &self,
        access_token: &str,
    ) -> Result<UserInfo, reqwest::Error> {
        let url = format!("{}{}", self.base_url, GET_USER_INFO_PATH);
        let resp = self
            .http
            .post(&url)
            .json(&serde_json::json!({ "accessToken": access_token }))
            .send()
            .await?;
        let data: GetUserInfoResponse = resp.json().await?;
        Ok(UserInfo {
            open_id: data.open_id,
            name: data.name,
            email: data.email,
            login_method: derive_login_method(data.platforms.as_deref(), data.platform.as_deref())
                .map(|s| s.to_string()),
        })
    }

    /// Get user info using a JWT session token.
    pub async fn get_user_info_with_jwt(
        &self,
        jwt_token: &str,
    ) -> Result<UserInfo, reqwest::Error> {
        let payload = GetUserInfoWithJwtRequest {
            jwt_token: jwt_token.to_string(),
            project_id: self.app_id.clone(),
        };

        let url = format!("{}{}", self.base_url, GET_USER_INFO_WITH_JWT_PATH);
        let resp = self.http.post(&url).json(&payload).send().await?;
        let data: GetUserInfoWithJwtResponse = resp.json().await?;
        Ok(UserInfo {
            open_id: data.open_id,
            name: data.name,
            email: data.email,
            login_method: derive_login_method(data.platforms.as_deref(), data.platform.as_deref())
                .map(|s| s.to_string()),
        })
    }
}

/// Normalized user info from OAuth.
#[derive(Debug, Clone)]
pub struct UserInfo {
    pub open_id: String,
    pub name: String,
    pub email: Option<String>,
    pub login_method: Option<String>,
}

/// Derive login method from platform data, matching Node.js deriveLoginMethod().
fn derive_login_method(platforms: Option<&[String]>, fallback: Option<&str>) -> Option<&'static str> {
    if let Some(fb) = fallback {
        if !fb.is_empty() {
            // Map known platform names
            return match fb {
                "email" => Some("email"),
                "google" => Some("google"),
                "apple" => Some("apple"),
                "microsoft" | "azure" => Some("microsoft"),
                "github" => Some("github"),
                _ => Some("other"),
            };
        }
    }

    let platforms = platforms?;
    if platforms.is_empty() {
        return None;
    }

    let set: Vec<&str> = platforms.iter().map(|s| s.as_str()).collect();
    if set.contains(&"REGISTERED_PLATFORM_EMAIL") {
        return Some("email");
    }
    if set.contains(&"REGISTERED_PLATFORM_GOOGLE") {
        return Some("google");
    }
    if set.contains(&"REGISTERED_PLATFORM_APPLE") {
        return Some("apple");
    }
    if set.contains(&"REGISTERED_PLATFORM_MICROSOPE") || set.contains(&"REGISTERED_PLATFORM_AZURE") {
        return Some("microsoft");
    }
    if set.contains(&"REGISTERED_PLATFORM_GITHUB") {
        return Some("github");
    }

    Some("other")
}

// ── Authentication flow ───────────────────────────────────────────────────

/// Authenticate a request from session cookie or Bearer token.
/// Matches the Node.js `sdk.authenticateRequest()` flow:
/// 1. Extract session from cookie or Authorization header
/// 2. Verify JWT
/// 3. Look up user in DB; if not found, sync from OAuth or create from session
/// 4. Update last_signed_in
pub async fn authenticate_request(
    pool: &PgPool,
    config: &Config,
    cookie_header: Option<&str>,
    auth_header: Option<&str>,
) -> Result<User, AuthError> {
    // Extract session token from cookie or Authorization header
    let session_token = extract_session_token(cookie_header, auth_header)
        .ok_or(AuthError::NoSession)?;

    // Verify JWT
    let session = session::verify_session(&session_token, &config.cookie_secret)
        .map_err(|e| {
            warn!("Session verification failed: {e}");
            AuthError::InvalidSession
        })?;

    debug!("Session verified for openId: {}", session.open_id);

    // Look up user in DB
    let mut user = get_user_by_open_id(pool, &session.open_id)
        .await
        .map_err(|e| AuthError::Database(e.to_string()))?;

    // If user not found, sync from OAuth or create from session data
    if user.is_none() {
        if !config.oauth_server_url.is_empty() {
            let oauth = OAuthClient::new(config);
            match oauth.get_user_info_with_jwt(&session_token).await {
                Ok(info) => {
                    upsert_user(
                        pool,
                        &info.open_id,
                        Some(&info.name),
                        info.email.as_deref(),
                        info.login_method.as_deref(),
                        None,
                        &config.owner_open_id,
                    )
                    .await
                    .map_err(|e| AuthError::Database(e.to_string()))?;
                    user = get_user_by_open_id(pool, &info.open_id)
                        .await
                        .map_err(|e| AuthError::Database(e.to_string()))?;
                }
                Err(e) => {
                    warn!("Failed to sync user from OAuth: {e}");
                    return Err(AuthError::OAuthSyncFailed);
                }
            }
        } else {
            // Create user from session data
            upsert_user(
                pool,
                &session.open_id,
                session.name.as_deref(),
                None,
                None,
                None,
                &config.owner_open_id,
            )
            .await
            .map_err(|e| AuthError::Database(e.to_string()))?;
            user = get_user_by_open_id(pool, &session.open_id)
                .await
                .map_err(|e| AuthError::Database(e.to_string()))?;
        }
    }

    let user = user.ok_or(AuthError::UserNotFound)?;

    // Update last_signed_in
    upsert_user(
        pool,
        &user.open_id,
        None,       // don't overwrite name
        None,       // don't overwrite email
        None,       // don't overwrite login_method
        None,       // don't overwrite role
        &config.owner_open_id,
    )
    .await
    .map_err(|e| AuthError::Database(e.to_string()))?;

    Ok(user)
}

/// Extract session token from cookie header or Authorization Bearer header.
fn extract_session_token(cookie_header: Option<&str>, auth_header: Option<&str>) -> Option<String> {
    const COOKIE_NAME: &str = "app_session_id";

    // Try cookie first
    if let Some(cookies) = cookie_header {
        for pair in cookies.split(';') {
            let pair = pair.trim();
            if let Some(token) = pair.strip_prefix(&format!("{}=", COOKIE_NAME)) {
                if !token.is_empty() {
                    return Some(token.to_string());
                }
            }
        }
    }

    // Try Authorization header
    if let Some(auth) = auth_header {
        if let Some(token) = auth.strip_prefix("Bearer ") {
            let token = token.trim();
            if !token.is_empty() {
                return Some(token.to_string());
            }
        }
    }

    None
}

/// Authentication errors.
#[derive(Debug)]
pub enum AuthError {
    NoSession,
    InvalidSession,
    UserNotFound,
    OAuthSyncFailed,
    Database(String),
}
