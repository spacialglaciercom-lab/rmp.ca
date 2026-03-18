import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const SITE_PASSWORD = process.env.SITE_PASSWORD ?? "";
const COOKIE_NAME = "site_auth";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

const LOGIN_HTML = (error = false) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Private — Enter Password</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #0a0a0a;
      color: #f0f0f0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
      border-radius: 12px;
      padding: 40px;
      width: 100%;
      max-width: 360px;
    }
    h1 { font-size: 1.25rem; margin-bottom: 8px; }
    p  { font-size: 0.875rem; color: #888; margin-bottom: 24px; }
    label { display: block; font-size: 0.8rem; color: #aaa; margin-bottom: 6px; }
    input[type="password"] {
      width: 100%;
      padding: 10px 14px;
      border-radius: 8px;
      border: 1px solid ${error ? "#f87171" : "#333"};
      background: #111;
      color: #f0f0f0;
      font-size: 1rem;
      margin-bottom: ${error ? "8px" : "20px"};
      outline: none;
    }
    input[type="password"]:focus { border-color: #555; }
    .error { color: #f87171; font-size: 0.8rem; margin-bottom: 16px; }
    button {
      width: 100%;
      padding: 10px;
      border-radius: 8px;
      border: none;
      background: #f0f0f0;
      color: #0a0a0a;
      font-size: 0.95rem;
      font-weight: 600;
      cursor: pointer;
    }
    button:hover { background: #ddd; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Private site</h1>
    <p>Enter the password to continue.</p>
    <form method="POST" action="/_auth">
      <label for="pw">Password</label>
      <input id="pw" type="password" name="password" autofocus autocomplete="current-password" />
      ${error ? '<p class="error">Incorrect password. Try again.</p>' : ""}
      <button type="submit">Continue</button>
    </form>
  </div>
</body>
</html>`;

export async function middleware(req: NextRequest) {
  // Skip if no password is set — site is public
  if (!SITE_PASSWORD) return NextResponse.next();

  const { pathname } = req.nextUrl;

  // Handle auth form POST
  if (req.method === "POST" && pathname === "/_auth") {
    const body = await req.text();
    const params = new URLSearchParams(body);
    const submitted = params.get("password") ?? "";
    const from = req.nextUrl.searchParams.get("from") ?? "/";

    if (submitted === SITE_PASSWORD) {
      const res = NextResponse.redirect(new URL(from, req.url));
      res.cookies.set(COOKIE_NAME, SITE_PASSWORD, {
        httpOnly: true,
        sameSite: "lax",
        maxAge: COOKIE_MAX_AGE,
        path: "/",
      });
      return res;
    }

    // Wrong password — show form with error
    return new NextResponse(LOGIN_HTML(true), {
      status: 401,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // Check auth cookie
  const cookie = req.cookies.get(COOKIE_NAME);
  if (cookie?.value === SITE_PASSWORD) return NextResponse.next();

  // Not authenticated — show login page
  const authUrl = new URL("/_auth", req.url);
  authUrl.searchParams.set("from", pathname);

  if (req.method !== "GET") {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // Rewrite the form action to include ?from=
  const html = LOGIN_HTML(false).replace(
    'action="/_auth"',
    `action="/_auth?from=${encodeURIComponent(pathname)}"`,
  );

  return new NextResponse(html, {
    status: 401,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
