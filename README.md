# Nightwatch Docs Renderer

A tool that crawls and renders the Nightwatch.js documentation website as static HTML pages for offline viewing, archiving, or custom hosting.

## 🚀 Features

- **Full Website Crawling**: Automatically discovers and renders all pages on the target domain
- **Preserves Structure**: Maintains the original URL structure in the output files
- **Configurable**: Set the maximum number of pages to crawl
- **GitHub Actions Integration**: Automatically builds and deploys to GitHub Pages
- **Scheduled Updates**: Can be configured to run on a schedule to keep the rendered site up-to-date

## 📋 Prerequisites

- Node.js 18 or higher
- npm or yarn

## 🛠️ Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/yourusername/nightwatch-docs-rendered.git
   cd nightwatch-docs-rendered
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

## 🔧 Usage

### Local Development

To render the website locally:

```bash
TARGET_URL=https://docs.nightwatch.io MAX_PAGES=100 npm run render
```

The rendered HTML files will be saved in the `dist` directory.

### Environment Variables

- `TARGET_URL` (required): The URL of the website to crawl and render
- `MAX_PAGES` (optional): Maximum number of pages to crawl (default: 100)

### Adding Custom Assets

If you need to include custom assets (CSS, JavaScript, images):

1. Create an `assets` directory in the project root
2. Add your files to this directory
3. These files will be copied to the `dist/assets` directory during the build process

## 🔄 GitHub Actions Workflow

This project includes a GitHub Actions workflow that:

1. Renders the website
2. Deploys the rendered site to GitHub Pages

The workflow runs:
- On every push to the main branch
- Weekly on Sundays (to keep the rendered site up-to-date)
- Manually when triggered through the GitHub Actions UI

### Configuring the Workflow

Edit the `.github/workflows/render-and-deploy.yml` file to customize:

- The target URL
- Maximum number of pages to crawl
- Schedule frequency
- Node.js version

## 📝 How It Works

1. The script starts at the specified `TARGET_URL`
2. It renders the page using Puppeteer (headless Chrome)
3. It extracts all links on the page that point to the same domain
4. It follows each link and repeats the process
5. Each page is saved with a path structure that matches its URL

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 🙏 Acknowledgements

- [Puppeteer](https://pptr.dev/) - Headless Chrome Node.js API
- [Nightwatch.io](https://nightwatch.io/) - SEO Rank Tracking Tool
