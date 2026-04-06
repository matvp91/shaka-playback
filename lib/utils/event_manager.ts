import { EventEmitter } from "@matvp91/eventemitter3";
import type { EventMap } from "../events";
import type { Player } from "../player";

type Binding = {
  remove: () => void;
};

type ListenOptions = {
  once?: boolean;
};

// biome-ignore lint/suspicious/noExplicitAny: callback variance
type EmitterCallback = (...args: any[]) => void;

type Callback = EmitterCallback | EventListenerOrEventListenerObject;

export class EventManager {
  private bindings_: Binding[] = [];

  listen<K extends keyof EventMap>(
    target: Player,
    event: K,
    callback: EventMap[K] extends undefined ? () => void : EventMap[K],
    options?: ListenOptions,
  ): void;
  listen(
    target: EventTarget,
    event: string,
    callback: EventListenerOrEventListenerObject,
    options?: ListenOptions,
  ): void;
  // biome-ignore lint/suspicious/noExplicitAny: unifies overloads
  listen(target: any, event: string, callback: any, options?: ListenOptions) {
    if (options?.once) {
      let binding: Binding;
      const wrapper = (...args: unknown[]) => {
        binding.remove();
        this.remove_(binding);
        (callback as EmitterCallback)(...args);
      };
      binding = this.subscribe_(target, event, wrapper);
      this.bindings_.push(binding);
      return;
    }
    const binding = this.subscribe_(target, event, callback);
    this.bindings_.push(binding);
  }

  /**
   * Remove all tracked listeners from all targets.
   */
  release() {
    for (const binding of this.bindings_) {
      binding.remove();
    }
    this.bindings_ = [];
  }

  private subscribe_(
    target: Player | EventTarget,
    event: string,
    callback: Callback,
  ): Binding {
    if (target instanceof EventTarget) {
      target.addEventListener(
        event,
        callback as EventListenerOrEventListenerObject,
      );
      return {
        remove: () =>
          target.removeEventListener(
            event,
            callback as EventListenerOrEventListenerObject,
          ),
      };
    }
    if (target instanceof EventEmitter) {
      const emitter = target as unknown as EventEmitter;
      emitter.on(event, callback as EmitterCallback);
      return {
        remove: () => emitter.off(event, callback as EmitterCallback),
      };
    }
    throw new Error("Unsupported target");
  }

  private remove_(binding: Binding) {
    const index = this.bindings_.indexOf(binding);
    if (index !== -1) {
      this.bindings_.splice(index, 1);
    }
  }
}
