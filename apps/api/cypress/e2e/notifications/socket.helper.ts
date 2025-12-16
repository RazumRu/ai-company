import { io, Socket } from 'socket.io-client';

export const createSocketConnection = (
  baseUrl: string,
  userId?: string,
): Socket => {
  // The API socket gateway requires a non-empty `token` in the handshake,
  // and (in dev auth mode) reads user identity from `x-dev-jwt-*` fields.
  const token = userId ?? '';
  const socket = io(baseUrl, {
    auth: {
      token,
      'x-dev-jwt-sub': userId,
    },
    transports: ['websocket'],
    reconnection: false,
  });

  // Avoid race conditions in tests where `socket_connected` can be emitted
  // before the waiting helper attaches its listener.
  (socket as unknown as { __socketConnected?: boolean }).__socketConnected =
    false;
  socket.on('socket_connected', () => {
    (socket as unknown as { __socketConnected?: boolean }).__socketConnected =
      true;
  });

  return socket;
};

export const waitForSocketEvent = (
  socket: Socket,
  eventName: string,
  timeout = 5000,
): Cypress.Chainable<unknown> => {
  return cy.wrap(
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for event: ${eventName}`));
      }, timeout);

      socket.once(eventName, (data) => {
        clearTimeout(timer);
        resolve(data);
      });
    }),
    { timeout },
  );
};

export const waitForSocketConnection = (
  socket: Socket,
  timeout = 5000,
): Cypress.Chainable<unknown> => {
  return cy.wrap(
    new Promise((resolve, reject) => {
      if (
        (socket as unknown as { __socketConnected?: boolean }).__socketConnected
      ) {
        resolve(undefined);
        return;
      }

      const timer = setTimeout(() => {
        reject(new Error('Timeout waiting for socket connection'));
      }, timeout);

      // The server emits `socket_connected` only after auth succeeds and the
      // user is joined to their personal room. Waiting for raw `connect` is
      // not sufficient because the transport can connect even when auth fails.
      socket.once('socket_connected', () => {
        clearTimeout(timer);
        resolve(undefined);
      });

      socket.once('server_error', (error) => {
        clearTimeout(timer);
        reject(error);
      });

      socket.once('connect_error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    }),
    { timeout },
  );
};

export const disconnectSocket = (socket: Socket) => {
  if (socket && socket.connected) {
    socket.disconnect();
  }
};
