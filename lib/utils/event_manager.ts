import { EventEmitter } from "@matvp91/eventemitter3";

type Binding = {
  remove: () => void;
};

type ListenOptions = {
  once?: boolean;
};

type EmitterCallback = (...args: unknown[]) => void;

type Callback = EmitterCallback | EventListenerOrEventListenerObject;

export class EventManager {
  private bindings_: Binding[] = [];

  listen<
    E extends EventEmitter.ValidEventTypes,
    K extends EventEmitter.EventNames<E>,
  >(
    target: EventEmitter<E>,
    event: K,
    callback: EventEmitter.EventListener<E, K>,
    options?: ListenOptions,
  ): void;
  listen(
    target: EventTarget,
    event: string,
    callback: EventListenerOrEventListenerObject,
    options?: ListenOptions,
  ): void;
  listen(
    target: EventEmitter | EventTarget,
    event: string,
    callback: Callback,
    options?: ListenOptions,
  ) {
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
    target: EventEmitter | EventTarget,
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
      target.on(event, callback as EmitterCallback);
      return {
        remove: () => target.off(event, callback as EmitterCallback),
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
