const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const TARGET_URL = process.env.TARGET_URL;

if (!TARGET_URL) {
  console.error('❌ TARGET_URL environment variable not set.');
  process.exit(1);
}

(async () => {
  const browser = await puppeteer.launch({ 
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  await page.goto(TARGET_URL, { waitUntil: 'networkidle0' });

  const content = await page.content();

  const outputDir = path.join(__dirname, 'dist');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

  fs.writeFileSync(path.join(outputDir, 'index.html'), content);
  await browser.close();
})();
