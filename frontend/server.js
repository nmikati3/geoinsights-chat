import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;
const BACKEND_URL = process.env.BACKEND_URL;

if (!BACKEND_URL) {
  console.error('BACKEND_URL environment variable is required');
  process.exit(1);
}

console.log(`Configured BACKEND_URL: ${BACKEND_URL}`);

// Check if running on GCP (Cloud Run sets this automatically)
const isOnGCP = process.env.K_SERVICE !== undefined;

// Token cache
let cachedToken = null;
let tokenExpiry = 0;

// Function to get GCP ID token for service-to-service authentication
async function getGCPIdToken(targetAudience) {
  if (!isOnGCP) {
    return null;
  }

  // Return cached token if still valid (with 5 min buffer)
  const now = Date.now();
  if (cachedToken && tokenExpiry > now + 300000) {
    return cachedToken;
  }

  try {
    const metadataUrl = `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${targetAudience}`;
    const response = await fetch(metadataUrl, {
      headers: { 'Metadata-Flavor': 'Google' },
    });

    if (!response.ok) {
      console.error('Failed to fetch ID token:', response.status, response.statusText);
      return null;
    }

    cachedToken = await response.text();
    // GCP tokens are valid for 1 hour
    tokenExpiry = now + 3600000;
    console.log('Fetched new GCP ID token');
    return cachedToken;
  } catch (error) {
    console.error('Error fetching GCP ID token:', error);
    return null;
  }
}

// Pre-fetch token on startup if on GCP
if (isOnGCP) {
  getGCPIdToken(BACKEND_URL).then(token => {
    if (token) {
      console.log('Pre-fetched GCP ID token on startup');
    }
  });
}

// Custom middleware to add auth header before proxying
async function addAuthHeader(req, res, next) {
  if (isOnGCP) {
    const token = await getGCPIdToken(BACKEND_URL);
    if (token) {
      req.headers['x-serverless-authorization'] = `Bearer ${token}`;
    }
  }
  next();
}

// API proxy middleware
const apiProxy = createProxyMiddleware({
  target: BACKEND_URL,
  changeOrigin: true,
  // Log proxy requests for debugging
  on: {
    proxyReq: (proxyReq, req, res) => {
      console.log(`Proxying: ${req.method} ${req.originalUrl} -> ${BACKEND_URL}${req.url}`);
    },
    proxyRes: (proxyRes, req, res) => {
      console.log(`Proxy response: ${proxyRes.statusCode} for ${req.originalUrl}`);
      // Disable buffering for streaming responses
      if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
        res.setHeader('X-Accel-Buffering', 'no');
      }
    },
    error: (err, req, res) => {
      console.error('Proxy error:', err.message);
    },
  },
});

// Use auth middleware then proxy for /api routes
app.use('/api', addAuthHeader, apiProxy);

// Serve static files from the dist directory
app.use(express.static(path.join(__dirname, 'dist')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).send('healthy\n');
});

// Handle SPA routing - serve index.html for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Proxying /api requests to ${BACKEND_URL}`);
  console.log(`Running on GCP: ${isOnGCP}`);
});
