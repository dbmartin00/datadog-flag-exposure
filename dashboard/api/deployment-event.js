import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-west-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (req.headers['x-deploy-webhook-secret'] !== process.env.DEPLOYMENT_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Invalid or missing webhook secret' });
  }

  const { service, env, version, started_at, finished_at, change_failure, team, git, custom_tags } = req.body || {};
  if (!service || !env || !version || !finished_at) {
    return res.status(400).json({ error: 'service, env, version, and finished_at are required' });
  }

  const event = {
    service: String(service),
    env: String(env),
    version: String(version),
    started_at: Number(started_at) || Number(finished_at),
    finished_at: Number(finished_at),
    change_failure: Boolean(change_failure), // defaults false — matches Datadog's "successful unless marked otherwise"
    team: team ? String(team) : null,
    git: git ? JSON.stringify(git) : null,
    custom_tags: custom_tags ? JSON.stringify(custom_tags) : null,
  };

  const key = `deployments/${event.env}/${event.finished_at}-${event.version}.json`;

  try {
    await s3Client.send(new PutObjectCommand({
      Bucket: process.env.EXPOSURE_S3_BUCKET,
      Key: key,
      Body: JSON.stringify(event),
      ContentType: 'application/json',
    }));
    res.status(201).json({ ok: true, key });
  } catch (err) {
    console.error('Failed to write deployment event to S3', err);
    res.status(500).json({ error: err.message || 'Write failed' });
  }
}
