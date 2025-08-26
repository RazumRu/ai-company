export interface IExceptionFieldError {
  message: string;
  name: string;
  path: string;
  index: string;
  value?: any;
}

export interface IExceptionData {
  name: string;
  statusCode: number;
  code: string;
  message: string;
  fullMessage: string;
  fields: IExceptionFieldError[];
  customData?: any;
}
