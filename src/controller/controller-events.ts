import { TrackRuntime } from '../domain/types';


export function getState(ctx: any): any {
    return (function(this: any) {
        return {
            isLoaded: this.isLoaded,
            isLoading: this.isLoading,
            isDestroyed: this.isDestroyed,
            longestDuration: this.longestDuration,
            features: { ...this.features },
            state: {
                ...this.state,
                loop: { ...this.state.loop },
            },
            tracks: this.runtimes.map(function(runtime: TrackRuntime) {
                return {
                    solo: runtime.state.solo,
                    volume: runtime.state.volume,
                    pan: runtime.state.pan,
                };
            }),
        };
    }).call(ctx);
}

export function on(ctx: any, eventName: any, handler: any): any {
    return (function(this: any, eventName: any, handler: any) {
        this.listeners[eventName].add(handler as unknown as (payload: unknown) => void);
        return () => this.off(eventName, handler);
    }).call(ctx, eventName, handler);
}

export function off(ctx: any, eventName: any, handler: any): any {
    return (function(this: any, eventName: any, handler: any) {
        this.listeners[eventName].delete(handler as unknown as (payload: unknown) => void);
    }).call(ctx, eventName, handler);
}

export function emit(ctx: any, eventName: any, payload: any): any {
    return (function(this: any, eventName: any, payload: any) {
        this.listeners[eventName].forEach(function(handler: (payload: unknown) => void) {
            handler(payload);
        });
    }).call(ctx, eventName, payload);
}
