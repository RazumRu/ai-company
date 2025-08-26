export const generateRandomInt = (
  min?: number,
  max?: number,
  floating?: boolean,
) => {
  return Cypress._.random(min ?? 1, max ?? 999999999, floating);
};

export const generateRandomUUID = () => {
  return crypto.randomUUID();
};

export const mockUserId = generateRandomUUID();
export const reqHeaders = {
  ['x-dev-user']: mockUserId,
};
