const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = process.env.PLAYTIME_PORT || 8099;
const URL = process.env.PLAYTIME_URL || `http://localhost:${PORT}/index.html`;
const RELOADS = Number(process.argv[2]) || 5;
const SLEEP_MS = 1000;

const CONTENT_TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };

function startServer() {
  const server = http.createServer((req, res) => {
    const filePath = path.join(__dirname, decodeURIComponent(req.url.split('?')[0]));
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': CONTENT_TYPES[path.extname(filePath)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, () => resolve(server));
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

console.log('=== reload.js: reloading index.html in a real browser (Puppeteer). ===');
console.log('=== This exercises the BROWSER flag demo only — it does NOT write to S3. ===');
console.log('=== For the S3-writing CLI pipeline, run flags.js / run-flags.sh instead. ===\n');

(async () => {
  const server = await startServer();
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: 'new',
    });
    const page = await browser.newPage();

    page.on('console', (msg) => {
      if (msg.type() !== 'log') return;
      Promise.all(msg.args().map((a) => a.jsonValue().catch(() => '[unserializable]')))
        .then((args) => {
          console.log(`  [console.log]`, ...args);
        });
    });

    for (let i = 1; i <= RELOADS; i++) {
      console.log(`\n=== Load ${i} ===`);
      if (i === 1) {
        await page.goto(URL, { waitUntil: 'networkidle0' });
      } else {
        await page.reload({ waitUntil: 'networkidle0' });
      }
      // let any async console logging settle
      await sleep(300);
      await sleep(SLEEP_MS);
    }
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})();
