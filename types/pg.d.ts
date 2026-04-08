declare module "pg" {
  export type ClientConfig = {
    connectionString?: string;
    ssl?: unknown;
  };

  export class Client {
    constructor(config?: ClientConfig);
    connect(): Promise<void>;
    query(statement: string): Promise<unknown>;
    end(): Promise<void>;
  }
}
