/**
 * Apply utils.js fix to @expo/ngrok after install (safe body access + NGROK_AUTHTOKEN from env).
 * The pnpm patch only applies client.js; this script patches utils.js so it survives installs.
 */
const fs = require("fs");
const path = require("path");

const utilsPath = path.join(
  process.cwd(),
  "node_modules",
  "@expo",
  "ngrok",
  "src",
  "utils.js"
);

if (!fs.existsSync(utilsPath)) {
  process.exit(0);
}

let content = fs.readFileSync(utilsPath, "utf8");

// 1) NGROK_AUTHTOKEN from env in defaults()
if (!content.includes("process.env.NGROK_AUTHTOKEN")) {
  content = content.replace(
    "  if (opts.httpauth) opts.auth = opts.httpauth;\n  return opts;",
    "  if (opts.httpauth) opts.auth = opts.httpauth;\n  if (!opts.authtoken && process.env.NGROK_AUTHTOKEN) opts.authtoken = process.env.NGROK_AUTHTOKEN;\n  return opts;"
  );
}

// 2) isRetriable: safe body/details access
if (content.includes("const body = err.body;") && !content.includes("err.body ?? err.response?.body")) {
  content = content.replace(
    "function isRetriable(err) {\n  if (!err.response) {\n    return false;\n  }\n  const statusCode = err.response.statusCode;\n  const body = err.body;\n  const notReady500 = statusCode === 500 && /panic/.test(body);\n  const notReady502 =\n    statusCode === 502 &&\n    body.details &&\n    body.details.err === \"tunnel session not ready yet\";\n  const notReady503 =\n    statusCode === 503 &&\n    body.details &&\n    body.details.err ===\n      \"a successful ngrok tunnel session has not yet been established\";\n  return notReady500 || notReady502 || notReady503;\n}",
    "function isRetriable(err) {\n  if (!err || !err.response) {\n    return false;\n  }\n  const statusCode = err.response.statusCode;\n  const body = err.body ?? err.response?.body ?? {};\n  const bodyStr = typeof body === \"string\" ? body : (body?.msg ?? \"\");\n  const details = body?.details ?? {};\n  const notReady500 = statusCode === 500 && /panic/.test(bodyStr);\n  const notReady502 =\n    statusCode === 502 &&\n    details.err === \"tunnel session not ready yet\";\n  const notReady503 =\n    statusCode === 503 &&\n    details.err ===\n      \"a successful ngrok tunnel session has not yet been established\";\n  return notReady500 || notReady502 || notReady503;\n}"
  );
}

fs.writeFileSync(utilsPath, content);
