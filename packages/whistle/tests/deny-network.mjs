// Inherited by worker_threads via execArgv. Fail the process on any attempted network.

import dgram from 'node:dgram';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import tls from 'node:tls';

const denied = () => {
  process.stderr.write('FORBIDDEN NETWORK ATTEMPT\n');
  process.exit(97);
};
globalThis.fetch = denied;
globalThis.WebSocket = class {
  constructor() {
    denied();
  }
};
net.connect = denied;
net.createConnection = denied;
net.Socket.prototype.connect = denied;
tls.connect = denied;
http.request = denied;
http.get = denied;
https.request = denied;
https.get = denied;
dns.lookup = denied;
dns.resolve = denied;
dns.promises.lookup = denied;
dns.promises.resolve = denied;
dgram.createSocket = denied;
syncBuiltinESMExports();
