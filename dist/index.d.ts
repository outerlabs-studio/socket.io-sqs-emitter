import type { DefaultEventsMap, EventNames, EventParams, EventsMap } from "./typed-events";
import { SNS } from "@aws-sdk/client-sns";
export interface EmitterOptions {
    /**
     * @default "socket.io"
     */
    topicName?: string;
}
interface BroadcastOptions {
    nsp: string;
    topicArn: string;
}
interface BroadcastFlags {
    volatile?: boolean;
    compress?: boolean;
}
export declare class Emitter<EmitEvents extends EventsMap = DefaultEventsMap> {
    readonly snsClient: SNS;
    readonly topicArn: string;
    readonly nsp: string;
    private readonly opts;
    private readonly broadcastOptions;
    constructor(snsClient: SNS, topicArn: string, nsp?: string);
    /**
     * Return a new emitter for the given namespace.
     *
     * @param nsp - namespace
     * @public
     */
    of(nsp: string): Emitter<EmitEvents>;
    /**
     * Emits to all clients.
     *
     * @return Always true
     * @public
     */
    emit<Ev extends EventNames<EmitEvents>>(ev: Ev, ...args: EventParams<EmitEvents, Ev>): Promise<true>;
    /**
     * Targets a room when emitting.
     *
     * @param room
     * @return BroadcastOperator
     * @public
     */
    to(room: string | string[]): BroadcastOperator<EmitEvents>;
    /**
     * Targets a room when emitting.
     *
     * @param room
     * @return BroadcastOperator
     * @public
     */
    in(room: string | string[]): BroadcastOperator<EmitEvents>;
    /**
     * Excludes a room when emitting.
     *
     * @param room
     * @return BroadcastOperator
     * @public
     */
    except(room: string | string[]): BroadcastOperator<EmitEvents>;
    /**
     * Sets a modifier for a subsequent event emission that the event data may be lost if the client is not ready to
     * receive messages (because of network slowness or other issues, or because they’re connected through long polling
     * and is in the middle of a request-response cycle).
     *
     * @return BroadcastOperator
     * @public
     */
    get volatile(): BroadcastOperator<EmitEvents>;
    /**
     * Sets the compress flag.
     *
     * @param compress - if `true`, compresses the sending data
     * @return BroadcastOperator
     * @public
     */
    compress(compress: boolean): BroadcastOperator<EmitEvents>;
    /**
     * Makes the matching socket instances join the specified rooms
     *
     * @param rooms
     * @public
     */
    socketsJoin(rooms: string | string[]): Promise<void>;
    /**
     * Makes the matching socket instances leave the specified rooms
     *
     * @param rooms
     * @public
     */
    socketsLeave(rooms: string | string[]): Promise<void>;
    /**
     * Makes the matching socket instances disconnect
     *
     * @param close - whether to close the underlying connection
     * @public
     */
    disconnectSockets(close?: boolean): Promise<void>;
    /**
     * Send a packet to the Socket.IO servers in the cluster
     *
     * @param args - any number of serializable arguments
     */
    serverSideEmit(...args: any[]): Promise<void>;
}
export declare const RESERVED_EVENTS: ReadonlySet<string | Symbol>;
export declare class BroadcastOperator<EmitEvents extends EventsMap> {
    private readonly snsClient;
    private readonly broadcastOptions;
    private readonly rooms;
    private readonly exceptRooms;
    private readonly flags;
    constructor(snsClient: SNS, broadcastOptions: BroadcastOptions, rooms?: Set<string>, exceptRooms?: Set<string>, flags?: BroadcastFlags);
    /**
     * Targets a room when emitting.
     *
     * @param room
     * @return a new BroadcastOperator instance
     * @public
     */
    to(room: string | string[]): BroadcastOperator<EmitEvents>;
    /**
     * Targets a room when emitting.
     *
     * @param room
     * @return a new BroadcastOperator instance
     * @public
     */
    in(room: string | string[]): BroadcastOperator<EmitEvents>;
    /**
     * Excludes a room when emitting.
     *
     * @param room
     * @return a new BroadcastOperator instance
     * @public
     */
    except(room: string | string[]): BroadcastOperator<EmitEvents>;
    /**
     * Sets the compress flag.
     *
     * @param compress - if `true`, compresses the sending data
     * @return a new BroadcastOperator instance
     * @public
     */
    compress(compress: boolean): BroadcastOperator<EmitEvents>;
    /**
     * Sets a modifier for a subsequent event emission that the event data may be lost if the client is not ready to
     * receive messages (because of network slowness or other issues, or because they’re connected through long polling
     * and is in the middle of a request-response cycle).
     *
     * @return a new BroadcastOperator instance
     * @public
     */
    get volatile(): BroadcastOperator<EmitEvents>;
    /**
     * Emits to all clients.
     *
     * @return Always true
     * @public
     */
    emit<Ev extends EventNames<EmitEvents>>(ev: Ev, ...args: EventParams<EmitEvents, Ev>): Promise<true>;
    /**
     * Makes the matching socket instances join the specified rooms
     *
     * @param rooms
     * @public
     */
    socketsJoin(rooms: string | string[]): Promise<void>;
    /**
     * Makes the matching socket instances leave the specified rooms
     *
     * @param rooms
     * @public
     */
    socketsLeave(rooms: string | string[]): Promise<void>;
    /**
     * Makes the matching socket instances disconnect
     *
     * @param close - whether to close the underlying connection
     * @public
     */
    disconnectSockets(close?: boolean): Promise<void>;
}
export {};
