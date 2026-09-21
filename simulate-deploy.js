// Posts a synthetic deployment event to the dashboard's webhook, standing in for
// a real CI/CD system (Jenkins, GitHub Actions, etc.) for this project.
// Usage: node simulate-deploy.js <env> <version> <success|failure> [service] [timestamp]

function requireEnv(name) {
  if (!process.env[name]) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
}

requireEnv('DEPLOYMENT_WEBHOOK_URL');
requireEnv('DEPLOYMENT_WEBHOOK_SECRET');

const env = process.argv[2] || process.env.DD_ENV || 'prod';
const version = process.argv[3] || `v${Date.now()}`;
const outcome = process.argv[4] || 'success';
const service = process.argv[5] || 'playtime';
const finished_at = process.argv[6] ? Number(process.argv[6]) : Date.now();

const event = {
  service,
  env,
  version,
  started_at: finished_at,
  finished_at,
  change_failure: outcome === 'failure',
};

async function main() {
  const res = await fetch(process.env.DEPLOYMENT_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-deploy-webhook-secret': process.env.DEPLOYMENT_WEBHOOK_SECRET },
    body: JSON.stringify(event),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`Webhook returned ${res.status}:`, body);
    process.exit(1);
  }
  console.log('[deploy event] sent', event, '->', body);
}

main();
