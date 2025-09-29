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
export const mockAppId = generateRandomUUID();

export const buildAuthHeaders = (params?: {
  userId?: string;
  appId?: string;
  permissions?: string[];
}) => {
  return {
    ['x-dev-jwt-sub']: params?.userId ?? mockUserId,
    ['x-dev-jwt-iss']: params?.appId ?? mockAppId,
    ['x-dev-jwt-permissions']: JSON.stringify(params?.permissions ?? ['*']),
  };
};

export const reqHeaders = buildAuthHeaders();
