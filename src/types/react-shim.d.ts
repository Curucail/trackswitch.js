declare module 'react' {
    export type ReactElement = any;
    export type CSSProperties = Record<string, string | number | undefined>;

    export interface MutableRefObject<T> {
        current: T;
    }

    export type RefCallback<T> = (instance: T | null) => void;
    export type Ref<T> = RefCallback<T> | MutableRefObject<T | null> | null;

    export interface RefAttributes<T> {
        ref?: Ref<T>;
    }

    export interface ForwardRefExoticComponent<P> {
        (props: P): ReactElement | null;
    }

    export function createElement(
        type: any,
        props?: Record<string, unknown> | null,
        ...children: any[]
    ): ReactElement;

    export function forwardRef<T, P = {}>(
        render: (props: P, ref: Ref<T>) => ReactElement | null
    ): ForwardRefExoticComponent<P & RefAttributes<T>>;

    export function useEffect(
        effect: () => void | (() => void),
        deps?: readonly unknown[]
    ): void;

    export function useImperativeHandle<T, R extends T>(
        ref: Ref<T> | undefined,
        init: () => R | null,
        deps?: readonly unknown[]
    ): void;

    export function useRef<T>(initialValue: T): MutableRefObject<T>;
}
