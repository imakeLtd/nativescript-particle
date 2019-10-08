export type TNSParticleDeviceType =
    "Unknown"
    | "Core"
    | "Photon"
    | "P1"
    | "Electron"
    | "RaspberryPi"
    | "DigistumpOak"
    | "RedBearDuo"
    | "Bluz";

export type VariableType = "INT" | "DOUBLE" | "STRING";

export function getDeviceType(id: number): TNSParticleDeviceType {
  switch (id) {
    case 0:
      return "Core";
    case 6:
      return "Photon";
    case 8:
      return "P1";
    case 10:
      return "Electron";
    case 31:
      return "RaspberryPi";
    case 82:
      return "DigistumpOak";
    case 88:
      return "RedBearDuo";
    case 103:
      return "Bluz";
    default:
      console.log(`Unknown device type (id: ${id})`);
      return "Unknown";
  }
}

export interface TNSParticleDeviceVariable {
  name: string;
  type: VariableType;
}

export interface TNSParticleEvent {
  prefix: string;
  event: string;
  data: string;
  date: Date;
  deviceID: string;
}

export interface TNSParticleDevice {
  id: string;
  name: string;
  status: string;
  connected: boolean;
  productId: number;
  type: TNSParticleDeviceType;
  functions: Array<string>;
  variables: Array<TNSParticleDeviceVariable>;
  eventIds: Map<string /* prefix */, any /* handler id */>;
  rename: (name: string) => Promise<void>;
  unclaim: () => Promise<void>;
  getVariable: (name: string) => Promise<any>;
  callFunction: (name: string, ...args) => Promise<number>;
  subscribe: (prefix: string, eventHandler: (event: TNSParticleEvent) => void) => void;
  unsubscribe: (prefix: string) => void;
}

export interface TNSParticleLoginOptions {
  username: string;
  password: string;
}

export interface TNSParticleAPI {
  login(options: TNSParticleLoginOptions): Promise<void>;

  loginWithToken(token: string, productId: number): void;

  setOAuthConfig(id: string, secret: string): void;

  logout(): void;

  isAuthenticated(): boolean;

  accessToken(): string;

  listDevices(productId: number): Promise<Array<TNSParticleDevice>>;

  startDeviceSetupWizard(productId: number): Promise<boolean>;

  getDeviceSetupCustomizer(): any;

  subscribe(prefix: string, eventHandler: (event: TNSParticleEvent) => void, productId: number): void;

  unsubscribe(prefix: string, productId: number): void;

  publish(name: string, data: string, isPrivate: boolean, ttl: number, productId: number, ): Promise<void>;

  authIfNeeded(productId: number): void;
}

