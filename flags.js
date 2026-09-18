const crypto = require('node:crypto');
const tracer = require('dd-trace');
const { OpenFeature } = require('@openfeature/server-sdk');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const s3Client = new S3Client({});

const DEFAULT_MESSAGE = 'Welcome! Come back later for a personalized message.';

// One shared 0-99 roll per invocation; thresholds all start at 0 so ranges
// nest inside one another (hitting a low-rate flag implies every flag above
// it in this list also hit that same roll).
const WEIGHTED_FLAGS = [
  { key: 'new_onboarding', threshold: 50 },
  { key: 'red',            threshold: 25 },
  { key: 'orange',         threshold: 12 },
  { key: 'yellow',         threshold: 6  },
  { key: 'green',          threshold: 3  },
  { key: 'blue',           threshold: 2  },
  { key: 'indigo',         threshold: 1  },
];

function requireEnv(name) {
  if (!process.env[name]) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
}

function getTargetingKey() {
  // No browser localStorage in a one-shot CLI run: mint a fresh identity per invocation.
  return crypto.randomUUID() + '-' + Date.now();
}

async function writeExposureToS3(exposure) {
  const key = `exposures/${exposure.flag}/${exposure.timestamp}-${exposure.targetingKey}.json`;
  try {
    await s3Client.send(new PutObjectCommand({
      Bucket: process.env.EXPOSURE_S3_BUCKET,
      Key: key,
      Body: JSON.stringify(exposure),
      ContentType: 'application/json',
    }));
    console.log(`[exposure] wrote s3://${process.env.EXPOSURE_S3_BUCKET}/${key}`);
  } catch (err) {
    console.error(`Failed to write exposure for "${exposure.flag}" to S3`, err);
  }
}

async function evaluateWeightedFlags(client, evaluationContext) {
  const roll = Math.floor(Math.random() * 100); // 0-99, shared by all flags this run
  for (const { key, threshold } of WEIGHTED_FLAGS) {
    if (roll >= threshold) continue;
    try {
      const value = await client.getBooleanValue(key, false, evaluationContext);
      console.log(`[${key} flag] treatment:`, value, false);
    } catch (err) {
      console.error(`Failed to evaluate the "${key}" feature flag`, err);
    }
  }
}

async function init() {
  tracer.init();

  // Evaluations fire hooks synchronously, but writing to S3 is async — collect the
  // in-flight write promises so init() can await them all before the process exits.
  const pendingExposureWrites = [];

  // Create a custom hook targeting evaluation lifecycle stages
  const auditLoggingHook = {
    // Executes successfully after the flag is resolved
    after: (hookContext, evaluationDetails) => {
      // console.log('evaluationDetails', evaluationDetails);
      const exposure = {
        targetingKey: evaluationContext.targetingKey,
        flag: evaluationDetails.flagKey,
        value: JSON.stringify(evaluationDetails.value),
        timestamp: evaluationDetails.flagMetadata.__dd_eval_timestamp_ms,
        variationType: evaluationDetails.flagMetadata.variationType,
        env: process.env.DD_ENV
      };
      console.log('exposure', exposure);
      pendingExposureWrites.push(writeExposureToS3(exposure));
    },
    
    // Executes if something goes wrong during evaluation
    error: (hookContext, err) => {
      console.error(`[OpenFeature Audit Error] Failed evaluating "${hookContext.flagKey}":`, err);
    }
  };

  // Register your hook globally so it runs on all evaluations across the app
  OpenFeature.addHooks(auditLoggingHook);


  const evaluationContext = {
    targetingKey: getTargetingKey(),
    userId: '123',
    userRole: 'admin',
  };

  try {
    await OpenFeature.setProviderAndWait(tracer.openfeature);
    const client = OpenFeature.getClient();
    const details = await client.getObjectDetails('playtime', {}, evaluationContext);
    // console.log('[playtime flag] resolution details:', details);
    console.log('[caption]', details.value?.motd || DEFAULT_MESSAGE);
    if (details.reason === 'ERROR' || details.reason === 'DEFAULT') {
      console.log(
        '[status]',
        `Flag resolved with reason "${details.reason}"` +
          (details.errorCode ? ` (${details.errorCode})` : '') +
          ' — see resolution details above for more.'
      );
    }

    await evaluateWeightedFlags(client, evaluationContext);
  } catch (err) {
    console.error('Failed to evaluate the "playtime" feature flag', err);
    console.log('[caption]', DEFAULT_MESSAGE);
    console.log('[status]', 'Could not reach Datadog — showing default message.');
  } finally {
    await Promise.allSettled(pendingExposureWrites);
  }
}

requireEnv('DD_API_KEY');
requireEnv('DD_SITE');
requireEnv('DD_ENV');
requireEnv('EXPOSURE_S3_BUCKET');

init().finally(() => process.exit(0));
