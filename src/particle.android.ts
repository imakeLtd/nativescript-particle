import { TNSParticleAPI, TNSParticleDevice, TNSParticleEvent, TNSParticleLoginOptions } from "./particle.common";
import * as utils from "tns-core-modules/utils/utils";
import { android as AndroidApp } from "tns-core-modules/application";

// keep these babies active while logged in as it holds state (our devices)
let worker = {};
let eventWorker = {};

export class Particle implements TNSParticleAPI {

  eventIds: Map<string /* prefix */, (event: TNSParticleEvent) => void /* handler */> = new Map();
  private tokens: any;
  private currentProduct: number;

  constructor() {
    io.particle.android.sdk.cloud.ParticleCloudSDK.init(utils.ad.getApplicationContext());
  }

  private initWorkerIfNeeded(productId): void {
    if (!worker[productId]) {
      if (global["TNS_WEBPACK"]) {
        const WorkerScript = require("nativescript-worker-loader!./particle-worker.js");
        worker[productId] = new WorkerScript();
      } else {
        worker[productId] = new Worker("./particle-worker.js");
      }
    }
  }

  private initEventWorkerIfNeeded(productId): void {
    if (!eventWorker[productId]) {
      if (global["TNS_WEBPACK"]) {
        const EventWorkerScript = require("nativescript-worker-loader!./particle-event-worker.js");
        eventWorker[productId] = new EventWorkerScript();
      } else {
        eventWorker[productId] = new Worker("./particle-event-worker.js");
      }

      eventWorker[productId].onmessage = msg => {
        if (msg.data.success) {
          console.log(">> success.. " + msg.data.handlerId);
          const handlerId = msg.data.handlerId;
          const handler = this.eventIds.get(handlerId);
          console.log(">> success.. handler: " + handler);
          handler && handler(msg.data.data);
        } else {
          console.log("----- no success");
        }
      };
    }
  }

  public login(options: TNSParticleLoginOptions): Promise<void> {
    this.initWorkerIfNeeded('common');

    return new Promise<void>((resolve, reject) => {
      worker['common'].postMessage({
        action: "login",
        options
      });

        worker['common'].onmessage = msg => msg.data.success ? resolve() : reject(msg.data.error);
    });
  }

  public loginWithToken(token: string, productId: number): void {
    if (productId) {
      this.tokens[productId] = token;
      this.currentProduct = productId;
  }
    io.particle.android.sdk.cloud.ParticleCloudSDK.getCloud().setAccessToken(token);
  }

  public setOAuthConfig(id: string, secret: string): void {
    console.log("'setOAuthConfig' is not currently implemented on Android. Feel like doing a PR? :)");
  }

  public logout(): void {
    // no need for a worker here because there are no network calls involved
    io.particle.android.sdk.cloud.ParticleCloudSDK.getCloud().logOut();
    Object.keys(worker).forEach(e => worker[e].terminate());
    Object.keys(eventWorker).forEach(e => eventWorker[e].terminate());
    eventWorker = worker = undefined;
  }

  public publish(name: string, data: string, isPrivate: boolean, ttl: number = 60, productId: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.authIfNeeded(productId);
      this.initWorkerIfNeeded(productId);

      worker[productId].postMessage({
        action: "publish",
        options: {
          name,
          data,
          isPrivate,
          ttl
        }
      });

      // 'publish' is fire & forget, so resolve immediately
      resolve();
    });
  }

  public subscribe(prefix: string, eventHandler: (event: TNSParticleEvent) => void, productId: number): void {
    if (this.eventIds.has(prefix)) {
      console.log(`Already subscribed for prefix '${prefix}' - not registering another event handler.`);
      return;
    }

    this.eventIds.set(prefix, eventHandler);
    this.authIfNeeded(productId);
    this.initEventWorkerIfNeeded(productId);

    eventWorker[productId].postMessage({
      action: "subscribe",
      options: {
        handlerId: prefix,
        prefix
      }
    });
  }

  public unsubscribe(prefix: string, productId: number): void {
    if (!this.eventIds.has(prefix)) {
      console.log(`No handler registered from prefix '${prefix}' - skipping unsubscribe`);
      return;
    }

    this.authIfNeeded(productId);
    this.initEventWorkerIfNeeded(productId);

    eventWorker[productId].postMessage({
      action: "unsubscribe",
      options: {
        prefix
      }
    });

    this.eventIds.delete(prefix);
  }

  public listDevices(productId: number): Promise<Array<TNSParticleDevice>> {
    return new Promise<Array<TNSParticleDevice>>((resolve, reject) => {

      this.authIfNeeded(productId);
      this.initWorkerIfNeeded(productId);
      this.initEventWorkerIfNeeded(productId);
      worker[productId].postMessage({
        action: "listDevices"
      });


      worker[productId].onmessage = msg => {
        if (msg.data.success) {
          const devices: Array<TNSParticleDevice> = msg.data.devices;
          // since the worker strips the functions, we're adding 'em back here as proxies to those implemented in the worker
          devices.map(device => {
            device.rename = (name: string): Promise<void> => this.renameDevice(device.id, name, device.productId);
            device.unclaim = (): Promise<void> => this.unclaimDevice(device.id, device.productId);
            device.callFunction = (name: string, args): Promise<number> => this.callFunction(device.id, name, args, device.productId);
            device.getVariable = (name: string): Promise<any> => this.getVariable(device.id, name, device.productId);
            device.subscribe = (prefix: string, eventHandler: (event: TNSParticleEvent) => void): void => this.subscribeDevice(device.id, prefix, eventHandler, device.productId);
            device.unsubscribe = (prefix: string): void => this.unsubscribeDevice(device.id, prefix, device.productId);
          });
          resolve(devices);
        } else {
          reject(msg.data.error);
        }
      };
    });
  }

  public isAuthenticated(): boolean {
    return io.particle.android.sdk.cloud.ParticleCloudSDK.getCloud().isLoggedIn();
  }

  public accessToken(): string {
    return io.particle.android.sdk.cloud.ParticleCloudSDK.getCloud().getAccessToken();
  }

  public startDeviceSetupWizard(productId: number): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {

      this.authIfNeeded(productId);
      // note that since we _have_ to return an intent, the activity is relaunched, so there's some state juggling required in the app
      const intent = AndroidApp.foregroundActivity.getIntent();

      io.particle.android.sdk.devicesetup.ParticleDeviceSetupLibrary.init(AndroidApp.foregroundActivity);

      const builder = new io.particle.android.sdk.devicesetup.SetupCompleteIntentBuilder({
        buildIntent: (context: globalAndroid.content.Context, setupResult: io.particle.android.sdk.devicesetup.SetupResult): globalAndroid.content.Intent => {
          resolve(setupResult.wasSuccessful());
          return intent;
        }
      });

      io.particle.android.sdk.devicesetup.ParticleDeviceSetupLibrary.startDeviceSetup(AndroidApp.foregroundActivity, builder);
    });
  }

  public getDeviceSetupCustomizer(): any {
    // stub for getDeviceSetupCustomizer
  }

  private renameDevice(deviceId: string, name: string, productId: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {

      this.authIfNeeded(productId);
      this.initWorkerIfNeeded(productId);

      worker[productId].postMessage({
        action: "rename",
        options: {
          deviceId,
          name
        }
      });

      worker[productId].onmessage = msg => msg.data.success ? resolve() : reject(msg.data.error);
    });
  }

  private unclaimDevice(deviceId: string, productId: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {

      this.authIfNeeded(productId);
      this.initWorkerIfNeeded(productId);

        worker[productId].postMessage({
        action: "unclaim",
        options: {
          deviceId
        }
      });

      worker[productId].onmessage = msg => msg.data.success ? resolve() : reject(msg.data.error);
    });
  }

  private callFunction(deviceId: string, name: string, args, productId: number): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      this.authIfNeeded(productId);
      this.initWorkerIfNeeded(productId);

      worker[productId].postMessage({
        action: "callFunction",
        options: {
          deviceId,
          name,
          args
        }
      });

      worker[productId].onmessage = msg => msg.data.success ? resolve(msg.data.result) : reject(msg.data.error);
    });
  }

  private getVariable(deviceId: string, name: string, productId: number): Promise<any> {
    return new Promise<any>((resolve, reject) => {
      this.authIfNeeded(productId);
      this.initWorkerIfNeeded(productId);

      worker[productId].postMessage({
        action: "getVariable",
        options: {
          deviceId,
          name
        }
      });

      worker[productId].onmessage = msg => msg.data.success ? resolve(msg.data.result) : reject(msg.data.error);
    });
  }

  private subscribeDevice(deviceId: string, prefix: string, eventHandler: (event: TNSParticleEvent) => void, productId: number): void {
    const handlerId = `${deviceId}_${prefix}`;

    if (this.eventIds.has(handlerId)) {
      console.log(`Already subscribed for prefix '${prefix}' - not registering another event handler.`);
      return;
    }

    this.eventIds.set(handlerId, eventHandler);

    this.authIfNeeded(productId);
    this.initEventWorkerIfNeeded(productId);

    eventWorker[productId].postMessage({
      action: "subscribeDevice",
      options: {
        handlerId,
        deviceId,
        prefix
      }
    });
  }

  private unsubscribeDevice(deviceId: string, prefix: string, productId: number): void {
    const handlerId = `${deviceId}_${prefix}`;

    if (!this.eventIds.has(handlerId)) {
      console.log(`No handler registered from prefix '${handlerId}' - skipping unsubscribe`);
      return;
    }

    this.authIfNeeded(productId);
    this.initEventWorkerIfNeeded(productId);

    eventWorker[productId].postMessage({
      action: "unsubscribeDevice",
      options: {
        handlerId,
        deviceId,
        prefix,
      }
    });

    this.eventIds.delete(handlerId);
  }

  public authIfNeeded(productId: number) : void {
    if (productId && this.tokens[productId] && this.currentProduct !== productId) {
        ParticleCloud.sharedInstance().injectSessionAccessToken(this.tokens[productId]);
    }
  }
}
