require("globals"); // necessary to bootstrap tns modules on the new thread

import { MyTNSParticleDevice } from "./particle-worker-base";
import { TNSParticleEvent } from "./particle.common";

const eventIds: Map<string /* prefix */, number /* handler id */> = new Map();


const subscribeFunction = (prefix: string, handlerId: string, deviceId?: string): void => {
  try {
    const handler = new io.particle.android.sdk.cloud.ParticleEventHandler({
      onEventError(exception: java.lang.Exception) {
        (<any>global).postMessage({success: false});
      },
      onEvent(eventName: string, event: io.particle.android.sdk.cloud.ParticleEvent) {
        if (event) {
          (<any>global).postMessage({
            success: true,
            handlerId,
            data: <TNSParticleEvent>{
              prefix,
              event: eventName,
              data: event.dataPayload,
              date: new Date(event.publishedAt.getTime()),
              deviceID: event.deviceId
            }
          });
        }
      }
    });

    const id = deviceId ? io.particle.android.sdk.cloud.ParticleCloudSDK.getCloud().subscribeToDeviceEvents(prefix, deviceId, handler)
                        : io.particle.android.sdk.cloud.ParticleCloudSDK.getCloud().subscribeToAllEvents(prefix, handler);
    eventIds.set(prefix, id);
  } catch (e) {
    console.log(e.nativeException.getBestMessage());
  }
};

const unsubscribeFunction = (prefix: string): void => {
  if (eventIds.has(prefix)) {
    io.particle.android.sdk.cloud.ParticleCloudSDK.getCloud().unsubscribeFromEventWithID(eventIds.get(prefix));
    eventIds.delete(prefix);
  }
};

(<any>global).onmessage = msg => {
  const request = msg.data;

  if (request.action === "subscribe") {
    subscribeFunction(request.options.prefix, request.options.handlerId);
    return;
  } else if (request.action === "unsubscribe") {
    unsubscribeFunction(request.options.prefix);
    return;
  } else if (request.action === "subscribeDevice") {
    subscribeFunction(request.options.prefix, request.options.handlerId, request.options.deviceId);
    return;
  } else if (request.action === "unsubscribeDevice") {
    unsubscribeFunction(request.options.prefix);
    return;
  } else {
    (<any>global).postMessage({success: false, error: `Unsupported action sent to worker: '${request.action}'`});
  }
};
