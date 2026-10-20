// 起動: node dev-server.cjs / 停止: Ctrl + C
// 同じLAN内の端末で確認するための開発用サーバーです。
'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

// リクエストのパスをファイルパスとして使わず、この3ファイルだけを許可します。
const routes = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']]
]);

const server = http.createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end('Method Not Allowed');
    return;
  }

  // URLを正規化・デコードせず照合し、親フォルダへの移動も許可しません。
  const pathname = request.url.split('?')[0];
  const route = routes.get(pathname);
  if (!route) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(request.method === 'HEAD' ? undefined : 'Not Found');
    return;
  }

  const [filename, contentType] = route;
  try {
    const content = await fs.readFile(path.join(__dirname, filename));
    response.writeHead(200, { 'Content-Type': contentType, 'Content-Length': content.length });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch (error) {
    console.error(`読み込み失敗: ${filename} (${error.code})`);
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(request.method === 'HEAD' ? undefined : 'Internal Server Error');
  }
});

server.on('error', (error) => {
  console.error(error.code === 'EADDRINUSE'
    ? 'ポート8000は使用中です。起動済みのサーバーを停止してから再実行してください。'
    : `サーバーを起動できません: ${error.message}`);
  process.exitCode = 1;
});

server.listen(8000, '0.0.0.0', () => {
  console.log('HIIT Timer: http://localhost:8000');
  console.log('iPhone: http://<PCのWi-Fi IPv4アドレス>:8000');
  console.log('待ち受け: 0.0.0.0:8000 / 停止: Ctrl + C');
});
