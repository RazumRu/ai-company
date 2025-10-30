import { mapKeys } from 'lodash';

export const removeKeysPrefix = <
  T extends Record<string, unknown> = Record<string, unknown>,
>(
  alias: string,
  data: T,
): T => {
  return <T>mapKeys(data, (value, key) => {
    const prefix = `${alias}_`;

    return key.startsWith(prefix) ? key.substring(prefix.length) : key;
  });
};
