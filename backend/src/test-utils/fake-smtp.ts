import { createServer, type Server, type Socket } from 'node:net';

/**
 * Spec-only SMTP server (TKT-0128). Two criteria are about what nodemailer *does* with the
 * transport options — gives up on a host that never greets, and caps its connections — so
 * mocking nodemailer would assert nothing. This speaks just enough SMTP for a delivery and
 * counts the sockets.
 *
 * `stall` accepts the connection and never writes the 220 greeting, which is what a
 * greetingTimeout has to catch.
 */
export interface FakeSmtp {
  port: number;
  /** Highest number of sockets open at the same moment. */
  peakConnections: number;
  /** Messages that reached the terminating dot. */
  messages: number;
  close(): Promise<void>;
}

export async function startFakeSmtp(mode: 'accept' | 'stall'): Promise<FakeSmtp> {
  const open = new Set<Socket>();
  const state: { peakConnections: number; messages: number } = { peakConnections: 0, messages: 0 };

  const server: Server = createServer((socket) => {
    open.add(socket);
    state.peakConnections = Math.max(state.peakConnections, open.size);
    socket.on('close', () => open.delete(socket));
    socket.on('error', () => open.delete(socket));

    if (mode === 'stall') return; // no greeting, ever

    let inData = false;
    let buffer = '';
    socket.write('220 fake ESMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let cut = buffer.indexOf('\r\n');
      while (cut !== -1) {
        const line = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            state.messages += 1;
            socket.write('250 OK\r\n');
          }
        } else if (/^(EHLO|HELO)/i.test(line)) {
          socket.write('250 fake\r\n');
        } else if (/^DATA/i.test(line)) {
          inData = true;
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (/^QUIT/i.test(line)) {
          socket.write('221 Bye\r\n');
          socket.end();
        } else {
          // MAIL FROM, RCPT TO, RSET, NOOP — nothing here needs to distinguish them.
          socket.write('250 OK\r\n');
        }
        cut = buffer.indexOf('\r\n');
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('fake SMTP server did not bind to a TCP port');
  }

  return {
    port: address.port,
    get peakConnections() {
      return state.peakConnections;
    },
    get messages() {
      return state.messages;
    },
    close() {
      for (const socket of open) socket.destroy();
      open.clear();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
