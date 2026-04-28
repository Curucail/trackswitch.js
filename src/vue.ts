import { defineComponent, h, onBeforeUnmount, onMounted, ref, watch, type PropType } from 'vue';
import { defineTrackswitchElement } from './element';
import type { TrackSwitchController, TrackSwitchEventMap, TrackSwitchInit } from './domain/types';
import type { TrackswitchPlayer } from './element';

type TrackSwitchVueEventHandlers = {
    loaded: (payload: TrackSwitchEventMap['loaded']) => true;
    error: (payload: TrackSwitchEventMap['error']) => true;
    position: (payload: TrackSwitchEventMap['position']) => true;
    trackState: (payload: TrackSwitchEventMap['trackState']) => true;
};

export interface TrackSwitchVueExpose {
    element: TrackswitchPlayer | null;
    controller: TrackSwitchController | null;
}

export const TrackSwitchPlayer = defineComponent({
    name: 'TrackSwitchPlayer',
    props: {
        init: {
            type: Object as PropType<TrackSwitchInit>,
            required: true,
        },
    },
    emits: {
        loaded: (_payload: TrackSwitchEventMap['loaded']) => true,
        error: (_payload: TrackSwitchEventMap['error']) => true,
        position: (_payload: TrackSwitchEventMap['position']) => true,
        trackState: (_payload: TrackSwitchEventMap['trackState']) => true,
    } satisfies TrackSwitchVueEventHandlers,
    setup(
        props: { init: TrackSwitchInit },
        {
            emit,
            expose,
            attrs,
        }: {
            emit: (eventName: keyof TrackSwitchVueEventHandlers, payload: any) => void;
            expose: (exposed: TrackSwitchVueExpose) => void;
            attrs: Record<string, unknown>;
        }
    ) {
        const elementRef = ref<TrackswitchPlayer | null>(null);

        const controller = function(): TrackSwitchController | null {
            return elementRef.value?.controller || null;
        };

        expose({
            get element() {
                return elementRef.value;
            },
            get controller() {
                return controller();
            },
        } satisfies TrackSwitchVueExpose);

        onMounted(() => {
            defineTrackswitchElement();
            if (elementRef.value) {
                elementRef.value.init = props.init;
            }
        });

        watch(
            () => props.init,
            (nextInit) => {
                if (elementRef.value) {
                    elementRef.value.init = nextInit;
                }
            },
            { deep: false }
        );

        const listeners: Array<() => void> = [];
        onMounted(() => {
            const element = elementRef.value;
            if (!element) {
                return;
            }

            const bind = function(eventName: string, vueEventName: keyof TrackSwitchVueEventHandlers) {
                const listener = function(event: Event) {
                    emit(vueEventName, (event as CustomEvent).detail);
                };
                element.addEventListener(eventName, listener);
                listeners.push(function unsubscribe() {
                    element.removeEventListener(eventName, listener);
                });
            };

            bind('trackswitch-loaded', 'loaded');
            bind('trackswitch-error', 'error');
            bind('trackswitch-position', 'position');
            bind('trackswitch-track-state', 'trackState');
        });

        onBeforeUnmount(() => {
            listeners.forEach((unsubscribe) => unsubscribe());
            listeners.length = 0;
        });

        return function render() {
            return h('trackswitch-player', {
                ...attrs,
                ref: elementRef,
            });
        };
    },
});

export default TrackSwitchPlayer;
