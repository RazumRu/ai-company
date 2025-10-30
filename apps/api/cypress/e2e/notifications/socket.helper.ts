import { io, Socket } from 'socket.io-client';

export const createSocketConnection = (
  baseUrl: string,
  userId?: string,
): Socket => {
  const socket = io(baseUrl, {
    auth: {
      'x-dev-jwt-sub': userId,
    },
    transports: ['websocket'],
    reconnection: false,
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
  );
};

export const waitForSocketConnection = (
  socket: Socket,
  timeout = 5000,
): Cypress.Chainable<unknown> => {
  return cy.wrap(
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Timeout waiting for socket connection'));
      }, timeout);

      if (socket.connected) {
        clearTimeout(timer);
        resolve(undefined);
        return;
      }

      socket.once('connect', () => {
        clearTimeout(timer);
        resolve(undefined);
      });

      socket.once('connect_error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    }),
  );
};

export const disconnectSocket = (socket: Socket) => {
  if (socket && socket.connected) {
    socket.disconnect();
  }
};
