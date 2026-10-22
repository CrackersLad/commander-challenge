const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8089;
const ROOT_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.wasm': 'application/wasm',
  '.jar': 'application/java-archive',
  '.class': 'application/java-vm',
  '.txt': 'text/plain; charset=utf-8',
  '.properties': 'text/plain; charset=utf-8'
};

const server = http.createServer((req, res) => {
  // CORS & Cross-Origin Isolation headers for CheerpJ / SharedArrayBuffer
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Accept');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
  res.setHeader('Accept-Ranges', 'bytes');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Parse and normalize URL pathname (eliminate double slashes)
  let reqPath = decodeURIComponent(req.url.split('?')[0]).replace(/\/+/g, '/');
  if (reqPath === '/' || reqPath === '') {
    reqPath = '/index.html';
  }

  // Strip CheerpJ /app/ mount prefix if present
  if (reqPath.startsWith('/app/')) {
    reqPath = reqPath.substring(4);
  }

  const rangeHeader = req.headers.range;
  console.log(`[HTTP ${req.method}] ${reqPath} ${rangeHeader ? '(Range: ' + rangeHeader + ')' : ''}`);

  const filePath = path.normalize(path.join(ROOT_DIR, reqPath));

  // Security check: ensure path stays within ROOT_DIR
  if (!filePath.startsWith(ROOT_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err) {
      // If CheerpJ requests an index.list that doesn't exist on disk, generate it dynamically from directory
      if (path.basename(filePath) === 'index.list') {
        const dirPath = path.dirname(filePath);
        try {
          if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            const listing = entries
              .filter(e => e.name !== 'index.list')
              .map(e => e.isDirectory() ? `${e.name}/` : e.name)
              .join('\n') + '\n';
            const buffer = Buffer.from(listing, 'utf-8');
            res.writeHead(200, {
              'Content-Type': 'text/plain; charset=utf-8',
              'Content-Length': buffer.length,
              'Accept-Ranges': 'bytes'
            });
            res.end(buffer);
            return;
          }
        } catch (dErr) {
          // Fall through to 404
        }
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`404 Not Found: ${reqPath}`);
      return;
    }

    let actualPath = filePath;
    let actualStats = stats;

    if (stats.isDirectory()) {
      const explicitIndex = path.join(filePath, 'index.list');
      if (fs.existsSync(explicitIndex)) {
        actualPath = explicitIndex;
        actualStats = fs.statSync(explicitIndex);
      } else {
        // Dynamically generate CheerpJ-compatible directory index.list
        try {
          const entries = fs.readdirSync(filePath, { withFileTypes: true });
          const listing = entries
            .map(e => e.isDirectory() ? `${e.name}/` : e.name)
            .join('\n') + '\n';
          const buffer = Buffer.from(listing, 'utf-8');
          res.writeHead(200, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Content-Length': buffer.length,
            'Accept-Ranges': 'bytes'
          });
          res.end(buffer);
          return;
        } catch (dirErr) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('500 Error listing directory: ' + dirErr.message);
          return;
        }
      }
    }

    const ext = path.extname(actualPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'text/plain; charset=utf-8';
    const totalSize = actualStats.size;

    // Support HTTP Range Requests (Critical for CheerpJ)
    const rangeHeader = req.headers.range;
    if (rangeHeader) {
      const parts = rangeHeader.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      let end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
      if (end >= totalSize) {
        end = totalSize - 1;
      }

      if (totalSize === 0) {
        res.writeHead(200, {
          'Content-Length': 0,
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes'
        });
        res.end();
        return;
      }

      if (start >= totalSize || start > end) {
        res.writeHead(416, {
          'Content-Range': `bytes */${totalSize}`,
          'Content-Type': 'text/plain'
        });
        res.end('416 Requested Range Not Satisfiable');
        return;
      }

      const chunkSize = (end - start) + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${totalSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType
      });

      const stream = fs.createReadStream(actualPath, { start, end });
      stream.pipe(res);
      stream.on('error', (streamErr) => {
        console.error('Stream error:', streamErr);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('500 Internal Server Error');
        }
      });
      return;
    }

    // Full file response
    res.writeHead(200, {
      'Content-Length': totalSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes'
    });

    const stream = fs.createReadStream(actualPath);
    stream.pipe(res);
    stream.on('error', (streamErr) => {
      console.error('Stream error:', streamErr);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('500 Internal Server Error');
      }
    });
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Commander Challenge App Server listening on http://127.0.0.1:${PORT}`);
  console.log(`Serving static files and Card-Forge assets from: ${ROOT_DIR}`);
});
