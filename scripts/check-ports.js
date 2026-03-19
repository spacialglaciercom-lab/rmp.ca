const net = require('net');

const ports = [3000, 4000, 9000, 3004]; // backend, docker-extract, local-extract, vroom
const services = {
  3000: 'Backend',
  4000: 'Extract (Docker)',
  9000: 'Extract (Local)',
  3004: 'Vroom (Docker)'
};

ports.forEach(port => {
  const socket = new net.Socket();
  socket.setTimeout(2000);
  socket.on('connect', () => {
    console.log(`[${services[port]}] Port ${port} is OPEN`);
    socket.destroy();
  });
  socket.on('timeout', () => {
    console.log(`[${services[port]}] Port ${port} TIMEOUT`);
    socket.destroy();
  });
  socket.on('error', (err) => {
    console.log(`[${services[port]}] Port ${port} CLOSED/ERROR: ${err.message}`);
  });
  socket.connect(port, '127.0.0.1');
});
