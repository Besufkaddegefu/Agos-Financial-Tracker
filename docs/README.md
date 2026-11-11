# BizGrow Marketing Website

This directory contains the marketing website for BizGrow, hosted on GitHub Pages.

## 🌐 Live Website


## 📁 Structure

```
docs/
├── index.html          # Main landing page
├── styles/
│   └── main.css        # Website styles
├── scripts/
│   └── main.js         # Website functionality
├── assets/             # Images, icons, and media
├── _config.yml         # GitHub Pages configuration
├── robots.txt          # SEO robots file
├── sitemap.xml         # SEO sitemap
└── CNAME              # Custom domain configuration
```

## 🎨 Features

- **Responsive Design** - Works on all devices
- **Modern UI** - Clean, professional design
- **SEO Optimized** - Meta tags, sitemap, robots.txt
- **Performance Optimized** - Lazy loading, compressed assets
- **Analytics Ready** - Google Analytics integration ready

## 🚀 Deployment

The website is automatically deployed to GitHub Pages when changes are pushed to the `main` branch.

### Manual Deployment

1. Ensure all files are in the `docs/` directory
2. Push changes to the repository
3. GitHub Pages will automatically build and deploy

### Custom Domain Setup

1. Add your domain to the `CNAME` file
2. Configure DNS settings with your domain provider
3. Enable HTTPS in GitHub Pages settings

## 🛠️ Development

### Local Development

1. Clone the repository
2. Navigate to the `docs/` directory
3. Serve the files using a local server:
   ```bash
   # Using Python
   python -m http.server 8000
   
   # Using Node.js
   npx serve .
   
   # Using PHP
   php -S localhost:8000
   ```
4. Open `http://localhost:8000` in your browser

### Making Changes

1. Edit the HTML, CSS, or JavaScript files
2. Test changes locally
3. Commit and push to deploy

## 📊 Analytics

The website includes placeholder code for Google Analytics. To enable:

1. Get a Google Analytics tracking ID
2. Add the tracking code to `index.html`
3. Update the `trackEvent` function in `main.js`

## 🎯 SEO

The website is optimized for search engines with:

- Semantic HTML structure
- Meta tags for social sharing
- Structured data markup
- XML sitemap
- Robots.txt file
- Fast loading times

## 📱 Social Media

Open Graph and Twitter Card meta tags are included for better social media sharing.

## 🔧 Customization

### Colors and Branding

Edit the CSS custom properties in `styles/main.css`:

```css
:root {
    --primary-color: #3b82f6;
    --secondary-color: #10b981;
    --accent-color: #f59e0b;
    /* ... */
}
```

### Content

Update the content in `index.html` to match your needs.

### Images

Add your images to the `assets/` directory and update the image paths in the HTML.

## 📞 Support

For website-related issues:
- Open an issue in the main repository
- Contact: bizgrowapp@gmail.com
- Discord: https://discord.gg/s27WGufPgp
