const http = require('http');
const net = require('net');

const GITHUB_IP = '140.82.121.3';

const server = http.createServer((req, res) => {
  res.writeHead(405);
  res.end('CONNECT only');
});

server.on('connect', (req, clientSocket, head) => {
  const [host, port] = req.url.split(':');
  const targetHost = (host === 'github.com' || host === 'api.github.com') ? GITHUB_IP : host;
  const targetPort = parseInt(port) || 443;

  const serverSocket = net.connect(targetPort, targetHost, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    serverSocket.write(head);
    serverSocket.pipe(clientSocket);
    clientSocket.pipe(serverSocket);
  });

  serverSocket.on('error', (err) => {
    try { clientSocket.end(); } catch (e) {}
  });
  clientSocket.on('error', () => {
    try { serverSocket.end(); } catch (e) {}
  });
});

server.listen(18080, '127.0.0.1', () => {
  console.log('Git proxy running on 127.0.0.1:18080');
});
