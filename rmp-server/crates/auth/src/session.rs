use chrono::Utc;
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

const JWT_ALGORITHM: jsonwebtoken::Algorithm = jsonwebtoken::Algorithm::HS256;

/// JWT session payload. Matches the Node.js `jose` JWT payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionPayload {
    /// User ID (from users.id)
    pub sub: String,
    /// User's openId from OAuth
    pub open_id: String,
    /// User name
    pub name: Option<String>,
    /// User email
    pub email: Option<String>,
    /// User role
    pub role: String,
    /// Organization ID
    pub org_id: Option<i32>,
    /// Issued at
    pub iat: i64,
    /// Expiration
    pub exp: i64,
}

/// Create a JWT session token.
pub fn create_session(
    user_id: i32,
    open_id: &str,
    name: Option<&str>,
    email: Option<&str>,
    role: &str,
    org_id: Option<i32>,
    secret: &str,
) -> Result<String, jsonwebtoken::errors::Error> {
    let now = Utc::now().timestamp();
    let payload = SessionPayload {
        sub: user_id.to_string(),
        open_id: open_id.to_string(),
        name: name.map(|s| s.to_string()),
        email: email.map(|s| s.to_string()),
        role: role.to_string(),
        org_id,
        iat: now,
        exp: now + (365 * 24 * 60 * 60), // 1 year, matching Node.js
    };

    encode(
        &Header::new(JWT_ALGORITHM),
        &payload,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
}

/// Verify and decode a JWT session token.
pub fn verify_session(token: &str, secret: &str) -> Result<SessionPayload, jsonwebtoken::errors::Error> {
    let mut validation = Validation::new(JWT_ALGORITHM);
    validation.validate_exp = true;

    let token_data = decode::<SessionPayload>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )?;

    Ok(token_data.claims)
}
