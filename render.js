const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// Check if we're in test mode
const isTestMode = process.argv.includes('--test');

// Configuration
const TARGET_URL = process.env.TARGET_URL || (isTestMode ? 'https://docs.nightwatch.io' : null);
const MAX_PAGES = isTestMode ? 3 : (process.env.MAX_PAGES || 100); // Limit the number of pages to crawl
const DOWNLOAD_EXTERNAL = isTestMode ? true : (process.env.DOWNLOAD_EXTERNAL === 'true'); // Whether to download external resources

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

// Function to download a file from a URL
function downloadFile(url, outputPath) {
  return new Promise((resolve, reject) => {
    ensureDirectoryExists(outputPath);

    // Determine if we need http or https
    const protocol = url.startsWith('https') ? https : http;

    const file = fs.createWriteStream(outputPath);

    protocol.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        downloadFile(redirectUrl, outputPath)
          .then(resolve)
          .catch(reject);
        return;
      }

      // Check if the request was successful
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download ${url}: ${response.statusCode}`));
        return;
      }

      // Pipe the response to the file
      response.pipe(file);

      // Handle errors
      file.on('error', (err) => {
        fs.unlink(outputPath, () => {}); // Delete the file on error
        reject(err);
      });

      // Close the file when done
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(outputPath, () => {}); // Delete the file on error
      reject(err);
    });
  });
}

// Function to rewrite links in the page to point to local files and collect external resources
async function rewriteLinks(page, baseDomain) {
  // This will hold all external resources we need to download
  const externalResources = [];

  await page.evaluate((domain) => {
    // Helper function to convert a URL to a local path
    function urlToLocalPath(url, attrType) {
      try {
        // Skip empty URLs, javascript: URLs, data: URLs, etc.
        if (!url ||
            url.startsWith('javascript:') ||
            url.startsWith('mailto:') ||
            url.startsWith('tel:') ||
            url.startsWith('data:') ||
            url.startsWith('#')) {
          return url;
        }

        // Parse the URL
        const parsedUrl = new URL(url, window.location.href);

        // Only rewrite URLs from the same domain
        if (parsedUrl.hostname !== domain) {
          return url;
        }

        // Get the pathname
        let pathname = parsedUrl.pathname;

        // Handle root path
        if (pathname === '/') {
          return attrType === 'href' ? './index.html' : './';
        }

        // For href attributes, handle HTML pages
        if (attrType === 'href') {
          // Remove trailing slash and add index.html for directories
          if (pathname.endsWith('/')) {
            pathname = pathname + 'index.html';
          } else if (!pathname.includes('.')) {
            // If no file extension, assume it's a directory and add index.html
            pathname = pathname + '/index.html';
          }
        }

        // Create relative path
        const relativePath = pathname.startsWith('/') ? '.' + pathname : './' + pathname;

        // Preserve hash and search params if they exist
        let result = relativePath;
        if (parsedUrl.search) {
          result += parsedUrl.search;
        }
        if (parsedUrl.hash) {
          result += parsedUrl.hash;
        }

        return result;
      } catch (e) {
        console.warn(`Error processing URL: ${url}`, e);
        return url;
      }
    }

    // 1. Rewrite anchor links
    const links = Array.from(document.querySelectorAll('a[href]'));
    links.forEach(link => {
      const href = link.getAttribute('href');
      const newHref = urlToLocalPath(href, 'href');
      if (newHref !== href) {
        link.setAttribute('href', newHref);
      }
    });

    // 2. Rewrite image sources
    const images = Array.from(document.querySelectorAll('img[src]'));
    images.forEach(img => {
      const src = img.getAttribute('src');
      const newSrc = urlToLocalPath(src, 'src');
      if (newSrc !== src) {
        img.setAttribute('src', newSrc);
      }
    });

    // 3. Rewrite CSS links
    const styleLinks = Array.from(document.querySelectorAll('link[rel="stylesheet"][href]'));
    styleLinks.forEach(link => {
      const href = link.getAttribute('href');
      const newHref = urlToLocalPath(href, 'href');
      if (newHref !== href) {
        link.setAttribute('href', newHref);
      }
    });

    // 4. Rewrite script sources
    const scripts = Array.from(document.querySelectorAll('script[src]'));
    scripts.forEach(script => {
      const src = script.getAttribute('src');
      const newSrc = urlToLocalPath(src, 'src');
      if (newSrc !== src) {
        script.setAttribute('src', newSrc);
      }
    });

    // 5. Rewrite inline CSS background images and imports
    const styleElements = Array.from(document.querySelectorAll('style'));
    styleElements.forEach(style => {
      if (style.textContent) {
        // This is a simple approach - for a more robust solution, a CSS parser would be needed
        let cssText = style.textContent;

        // Replace url(...) patterns
        cssText = cssText.replace(/url\(['"]?([^'")]+)['"]?\)/g, (_, url) => {
          const newUrl = urlToLocalPath(url, 'url');
          return `url('${newUrl}')`;
        });

        // Replace @import url(...) patterns
        cssText = cssText.replace(/@import\s+['"]([^'"]+)['"]/g, (_, url) => {
          const newUrl = urlToLocalPath(url, 'import');
          return `@import '${newUrl}'`;
        });

        style.textContent = cssText;
      }
    });

    // 6. Rewrite inline style attributes with background images
    const elementsWithStyle = Array.from(document.querySelectorAll('[style]'));
    elementsWithStyle.forEach(el => {
      const style = el.getAttribute('style');
      if (style && style.includes('url(')) {
        const newStyle = style.replace(/url\(['"]?([^'")]+)['"]?\)/g, (_, url) => {
          const newUrl = urlToLocalPath(url, 'url');
          return `url('${newUrl}')`;
        });
        el.setAttribute('style', newStyle);
      }
    });

    // 7. Handle base tag if present
    const baseTag = document.querySelector('base[href]');
    if (baseTag) {
      // Remove or update the base tag as it can interfere with relative URLs
      baseTag.remove();
    }
  }, baseDomain);

  // If DOWNLOAD_EXTERNAL is enabled, collect external resources
  if (DOWNLOAD_EXTERNAL) {
    // Get all external resources (CSS, JS, images)
    const externalCSS = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('link[rel="stylesheet"][href]'))
        .map(link => link.href)
        .filter(href => href && !href.startsWith('data:'));
    });

    const externalJS = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('script[src]'))
        .map(script => script.src)
        .filter(src => src && !src.startsWith('data:'));
    });

    const externalImages = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('img[src]'))
        .map(img => img.src)
        .filter(src => src && !src.startsWith('data:'));
    });

    // Add all resources to the list
    externalResources.push(...externalCSS, ...externalJS, ...externalImages);
  }

  return externalResources;
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

      // Rewrite links in the page to point to local files and collect external resources
      const externalResources = await rewriteLinks(page, baseDomain);

      // Get the modified content and save it
      const content = await page.content();
      const filePath = path.join(outputDir, getFilePath(finalUrl));

      ensureDirectoryExists(filePath);
      fs.writeFileSync(filePath, content);

      // Download external resources if enabled
      if (DOWNLOAD_EXTERNAL && externalResources.length > 0) {
        console.log(`Found ${externalResources.length} external resources to download for ${finalUrl}`);

        // Process each external resource
        for (const resourceUrl of externalResources) {
          try {
            // Skip resources from other domains
            const resourceUrlObj = new URL(resourceUrl);
            if (resourceUrlObj.hostname !== baseDomain) {
              continue;
            }

            // Get the file path for the resource
            const resourcePath = path.join(outputDir, resourceUrlObj.pathname.startsWith('/')
              ? resourceUrlObj.pathname.substring(1)
              : resourceUrlObj.pathname);

            // Skip if already downloaded
            if (fs.existsSync(resourcePath)) {
              continue;
            }

            console.log(`Downloading: ${resourceUrl}`);
            await downloadFile(resourceUrl, resourcePath);
          } catch (error) {
            console.warn(`Failed to download resource ${resourceUrl}: ${error.message}`);
          }
        }
      }

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
