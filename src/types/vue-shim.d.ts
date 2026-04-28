declare module 'vue' {
    export type PropType<T> = any;

    export interface Ref<T> {
        value: T;
    }

    export function defineComponent(options: any): any;
    export function h(type: any, props?: Record<string, unknown> | null, ...children: any[]): any;
    export function onMounted(callback: () => void): void;
    export function onBeforeUnmount(callback: () => void): void;
    export function ref<T>(value: T): Ref<T>;
    export function watch<T>(
        source: () => T,
        callback: (value: T, oldValue: T | undefined) => void,
        options?: Record<string, unknown>
    ): void;
}
