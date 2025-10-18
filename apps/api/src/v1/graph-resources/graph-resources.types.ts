export interface ShellResourceData {
  env?: Record<string, string>;
  initScript?: string[] | string;
  initScriptTimeout?: number;
}

export interface IBaseResourceOutput<T = unknown> {
  information: string;
  kind: ResourceKind;
  data: T;
}

export interface IShellResourceOutput
  extends IBaseResourceOutput<ShellResourceData> {}

export enum ResourceKind {
  Shell = 'Shell',
}
