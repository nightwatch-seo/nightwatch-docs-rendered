const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const TARGET_URL = process.env.TARGET_URL;
const MAX_PAGES = process.env.MAX_PAGES || 100; // Limit the number of pages to crawl

if (!TARGET_URL) {
  console.error('❌ TARGET_URL environment variable not set.');
  process.exit(1);
}

// Parse the target URL to get the base domain
const parsedUrl = new URL(TARGET_URL);
const baseDomain = parsedUrl.hostname;

// Create a set to track visited URLs
const visitedUrls = new Set();
// Create a queue of URLs to visit
const urlsToVisit = [TARGET_URL];

// Function to normalize URLs
function normalizeUrl(pageUrl) {
  // Remove trailing slash
  if (pageUrl.endsWith('/')) {
    pageUrl = pageUrl.slice(0, -1);
  }
  // Remove hash
  pageUrl = pageUrl.split('#')[0];
  return pageUrl;
}

// Function to get the file path for a URL
function getFilePath(pageUrl) {
  const parsedPageUrl = new URL(pageUrl);
  let filePath = parsedPageUrl.pathname;

  // Handle root path
  if (filePath === '/') {
    return 'index.html';
  }

  // Remove leading slash
  if (filePath.startsWith('/')) {
    filePath = filePath.substring(1);
  }

  // Handle paths without extensions
  if (!path.extname(filePath) && !filePath.endsWith('/')) {
    filePath = `${filePath}/index.html`;
  } else if (filePath.endsWith('/')) {
    filePath = `${filePath}index.html`;
  } else if (!filePath.endsWith('.html') && !path.extname(filePath)) {
    filePath = `${filePath}.html`;
  }

  return filePath;
}

// Function to extract links from a page
async function extractLinks(page) {
  return await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href]'));
    return links.map(link => link.href);
  });
}

// Function to ensure directory exists
function ensureDirectoryExists(filePath) {
  const dirname = path.dirname(filePath);
  if (!fs.existsSync(dirname)) {
    fs.mkdirSync(dirname, { recursive: true });
  }
}

// Main crawling function
async function crawlAndRender() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const outputDir = path.join(__dirname, 'dist');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
  }

  // Copy assets directory if it exists
  if (fs.existsSync(path.join(__dirname, 'assets'))) {
    fs.cpSync(path.join(__dirname, 'assets'), path.join(outputDir, 'assets'), { recursive: true });
  }

  let pageCount = 0;

  while (urlsToVisit.length > 0 && pageCount < MAX_PAGES) {
    const currentUrl = urlsToVisit.shift();
    const normalizedUrl = normalizeUrl(currentUrl);

    if (visitedUrls.has(normalizedUrl)) {
      continue;
    }

    console.log(`Rendering page ${pageCount + 1}: ${normalizedUrl}`);

    try {
      const page = await browser.newPage();
      await page.goto(normalizedUrl, { waitUntil: 'networkidle0', timeout: 60000 });

      // Get the final URL after any redirects
      const finalUrl = page.url();
      const normalizedFinalUrl = normalizeUrl(finalUrl);

      // Mark as visited
      visitedUrls.add(normalizedUrl);
      if (normalizedFinalUrl !== normalizedUrl) {
        visitedUrls.add(normalizedFinalUrl);
      }

      // Extract and process links
      const links = await extractLinks(page);
      for (const link of links) {
        try {
          const parsedLink = new URL(link);
          // Only process links from the same domain
          if (parsedLink.hostname === baseDomain && !visitedUrls.has(normalizeUrl(link))) {
            urlsToVisit.push(link);
          }
        } catch (e) {
          // Skip invalid URLs
          console.warn(`Skipping invalid URL: ${link}`);
        }
      }

      // Get the content and save it
      const content = await page.content();
      const filePath = path.join(outputDir, getFilePath(finalUrl));

      ensureDirectoryExists(filePath);
      fs.writeFileSync(filePath, content);

      await page.close();
      pageCount++;

    } catch (error) {
      console.error(`Error processing ${currentUrl}:`, error.message);
    }
  }

  console.log(`Rendered ${pageCount} pages.`);
  if (urlsToVisit.length > 0 && pageCount >= MAX_PAGES) {
    console.log(`Reached maximum page limit (${MAX_PAGES}). ${urlsToVisit.length} URLs remaining.`);
  }

  await browser.close();
}

// Start the crawling process
(async () => {
  try {
    await crawlAndRender();
    console.log('✅ Crawling and rendering completed successfully!');
  } catch (error) {
    console.error('❌ Error during crawling and rendering:', error);
    process.exit(1);
  }
})();
