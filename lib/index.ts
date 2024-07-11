import { MessageType } from "socket.io-adapter";
import debugModule from "debug";
import type {
  DefaultEventsMap,
  EventNames,
  EventParams,
  EventsMap,
} from "./typed-events";
import {
  MessageAttributeValue,
  PublishCommand,
  SNS,
  SNSClient,
} from "@aws-sdk/client-sns";
import { encode } from "notepack.io";
import { PacketType } from "socket.io-parser";

const debug = debugModule("socket.io-emitter");

const UID = "emitter";

/**
 * Request types, for messages between nodes
 */

enum RequestType {
  SOCKETS = 0,
  ALL_ROOMS = 1,
  REMOTE_JOIN = 2,
  REMOTE_LEAVE = 3,
  REMOTE_DISCONNECT = 4,
  REMOTE_FETCH = 5,
  SERVER_SIDE_EMIT = 6,
}

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

async function publish(
  client: SNSClient,
  topic: string,
  type: number,
  nsp: string | undefined,
  uid: string | undefined,
  data?: any
) {
  try {
    const messageAttributes: Record<string, MessageAttributeValue> = {};
    if (nsp) {
      messageAttributes.nsp = {
        DataType: "String",
        StringValue: nsp,
      };
    }

    if (UID) {
      messageAttributes.uid = {
        DataType: "String",
        StringValue: UID,
      };
    }

    if (data) {
      // no binary can be included in the body, so we include it in a message attribute
      messageAttributes.data = {
        DataType: "Binary",
        BinaryValue: encode(data),
      };
    }

    return client
      .send(
        new PublishCommand({
          TopicArn: topic,
          Message: String(type),
          MessageAttributes: messageAttributes,
        })
      )
      .then(() => {
        debug("published message %d to SNS topic %s", type, topic);
      })
      .catch(console.log);
  } catch (e) {
    console.log(e);
  }
}

export class Emitter<EmitEvents extends EventsMap = DefaultEventsMap> {
  private readonly opts: EmitterOptions;
  private readonly broadcastOptions: BroadcastOptions;

  constructor(
    readonly snsClient: SNS,
    readonly topicArn: string,
    readonly nsp: string = "/"
  ) {
    this.broadcastOptions = {
      nsp,
      topicArn,
    };
  }

  /**
   * Return a new emitter for the given namespace.
   *
   * @param nsp - namespace
   * @public
   */
  public of(nsp: string): Emitter<EmitEvents> {
    return new Emitter(
      this.snsClient,
      this.topicArn,
      (nsp[0] !== "/" ? "/" : "") + nsp
    );
  }

  /**
   * Emits to all clients.
   *
   * @return Always true
   * @public
   */
  public async emit<Ev extends EventNames<EmitEvents>>(
    ev: Ev,
    ...args: EventParams<EmitEvents, Ev>
  ): Promise<true> {
    return new BroadcastOperator<EmitEvents>(
      this.snsClient,
      this.broadcastOptions
    ).emit(ev, ...args);
  }

  /**
   * Targets a room when emitting.
   *
   * @param room
   * @return BroadcastOperator
   * @public
   */
  public to(room: string | string[]): BroadcastOperator<EmitEvents> {
    return new BroadcastOperator(this.snsClient, this.broadcastOptions).to(
      room
    );
  }

  /**
   * Targets a room when emitting.
   *
   * @param room
   * @return BroadcastOperator
   * @public
   */
  public in(room: string | string[]): BroadcastOperator<EmitEvents> {
    return new BroadcastOperator(this.snsClient, this.broadcastOptions).in(
      room
    );
  }

  /**
   * Excludes a room when emitting.
   *
   * @param room
   * @return BroadcastOperator
   * @public
   */
  public except(room: string | string[]): BroadcastOperator<EmitEvents> {
    return new BroadcastOperator(this.snsClient, this.broadcastOptions).except(
      room
    );
  }

  /**
   * Sets a modifier for a subsequent event emission that the event data may be lost if the client is not ready to
   * receive messages (because of network slowness or other issues, or because they’re connected through long polling
   * and is in the middle of a request-response cycle).
   *
   * @return BroadcastOperator
   * @public
   */
  public get volatile(): BroadcastOperator<EmitEvents> {
    return new BroadcastOperator(this.snsClient, this.broadcastOptions)
      .volatile;
  }

  /**
   * Sets the compress flag.
   *
   * @param compress - if `true`, compresses the sending data
   * @return BroadcastOperator
   * @public
   */
  public compress(compress: boolean): BroadcastOperator<EmitEvents> {
    return new BroadcastOperator(
      this.snsClient,
      this.broadcastOptions
    ).compress(compress);
  }

  /**
   * Makes the matching socket instances join the specified rooms
   *
   * @param rooms
   * @public
   */
  public async socketsJoin(rooms: string | string[]): Promise<void> {
    return new BroadcastOperator(
      this.snsClient,
      this.broadcastOptions
    ).socketsJoin(rooms);
  }

  /**
   * Makes the matching socket instances leave the specified rooms
   *
   * @param rooms
   * @public
   */
  public async socketsLeave(rooms: string | string[]): Promise<void> {
    return new BroadcastOperator(
      this.snsClient,
      this.broadcastOptions
    ).socketsLeave(rooms);
  }

  /**
   * Makes the matching socket instances disconnect
   *
   * @param close - whether to close the underlying connection
   * @public
   */
  public async disconnectSockets(close: boolean = false): Promise<void> {
    return new BroadcastOperator(
      this.snsClient,
      this.broadcastOptions
    ).disconnectSockets(close);
  }

  /**
   * Send a packet to the Socket.IO servers in the cluster
   *
   * @param args - any number of serializable arguments
   */
  public async serverSideEmit(...args: any[]): Promise<void> {
    const withAck = typeof args[args.length - 1] === "function";

    if (withAck) {
      throw new Error("Acknowledgements are not supported");
    }

    await publish(
      this.snsClient,
      this.broadcastOptions.topicArn,
      MessageType.SERVER_SIDE_EMIT,
      this.broadcastOptions.nsp,
      UID,
      {
        packet: args,
      }
    );
  }
}

export const RESERVED_EVENTS: ReadonlySet<string | Symbol> = new Set(<const>[
  "connect",
  "connect_error",
  "disconnect",
  "disconnecting",
  "newListener",
  "removeListener",
]);

export class BroadcastOperator<EmitEvents extends EventsMap> {
  constructor(
    private readonly snsClient: SNS,
    private readonly broadcastOptions: BroadcastOptions,
    private readonly rooms: Set<string> = new Set<string>(),
    private readonly exceptRooms: Set<string> = new Set<string>(),
    private readonly flags: BroadcastFlags = {}
  ) {}

  /**
   * Targets a room when emitting.
   *
   * @param room
   * @return a new BroadcastOperator instance
   * @public
   */
  public to(room: string | string[]): BroadcastOperator<EmitEvents> {
    const rooms = new Set(this.rooms);
    if (Array.isArray(room)) {
      room.forEach((r) => rooms.add(r));
    } else {
      rooms.add(room);
    }

    return new BroadcastOperator(
      this.snsClient,
      this.broadcastOptions,
      rooms,
      this.exceptRooms,
      this.flags
    );
  }

  /**
   * Targets a room when emitting.
   *
   * @param room
   * @return a new BroadcastOperator instance
   * @public
   */
  public in(room: string | string[]): BroadcastOperator<EmitEvents> {
    return this.to(room);
  }

  /**
   * Excludes a room when emitting.
   *
   * @param room
   * @return a new BroadcastOperator instance
   * @public
   */
  public except(room: string | string[]): BroadcastOperator<EmitEvents> {
    const exceptRooms = new Set(this.exceptRooms);
    if (Array.isArray(room)) {
      room.forEach((r) => exceptRooms.add(r));
    } else {
      exceptRooms.add(room);
    }
    return new BroadcastOperator(
      this.snsClient,
      this.broadcastOptions,
      this.rooms,
      exceptRooms,
      this.flags
    );
  }

  /**
   * Sets the compress flag.
   *
   * @param compress - if `true`, compresses the sending data
   * @return a new BroadcastOperator instance
   * @public
   */
  public compress(compress: boolean): BroadcastOperator<EmitEvents> {
    const flags = Object.assign({}, this.flags, { compress });
    return new BroadcastOperator(
      this.snsClient,
      this.broadcastOptions,
      this.rooms,
      this.exceptRooms,
      flags
    );
  }

  /**
   * Sets a modifier for a subsequent event emission that the event data may be lost if the client is not ready to
   * receive messages (because of network slowness or other issues, or because they’re connected through long polling
   * and is in the middle of a request-response cycle).
   *
   * @return a new BroadcastOperator instance
   * @public
   */
  public get volatile(): BroadcastOperator<EmitEvents> {
    const flags = Object.assign({}, this.flags, { volatile: true });
    return new BroadcastOperator(
      this.snsClient,
      this.broadcastOptions,
      this.rooms,
      this.exceptRooms,
      flags
    );
  }

  /**
   * Emits to all clients.
   *
   * @return Always true
   * @public
   */
  public async emit<Ev extends EventNames<EmitEvents>>(
    ev: Ev,
    ...args: EventParams<EmitEvents, Ev>
  ): Promise<true> {
    if (RESERVED_EVENTS.has(ev)) {
      throw new Error(`"${String(ev)}" is a reserved event name`);
    }

    // set up packet object
    const data = [ev, ...args];
    const packet = {
      type: PacketType.EVENT,
      data: data,
      nsp: this.broadcastOptions.nsp,
    };

    const opts = {
      rooms: [...this.rooms],
      flags: this.flags,
      except: [...this.exceptRooms],
    };

    await publish(
      this.snsClient,
      this.broadcastOptions.topicArn,
      MessageType.BROADCAST,
      this.broadcastOptions.nsp,
      UID,
      {
        packet,
        opts,
      }
    );

    return true;
  }

  /**
   * Makes the matching socket instances join the specified rooms
   *
   * @param rooms
   * @public
   */
  public async socketsJoin(rooms: string | string[]): Promise<void> {
    await publish(
      this.snsClient,
      this.broadcastOptions.topicArn,
      MessageType.SOCKETS_JOIN,
      this.broadcastOptions.nsp,
      UID,
      {
        opts: {
          rooms: [...this.rooms],
          except: [...this.exceptRooms],
        },
        rooms: Array.isArray(rooms) ? rooms : [rooms],
      }
    );
  }

  /**
   * Makes the matching socket instances leave the specified rooms
   *
   * @param rooms
   * @public
   */
  public async socketsLeave(rooms: string | string[]): Promise<void> {
    await publish(
      this.snsClient,
      this.broadcastOptions.topicArn,
      MessageType.SOCKETS_LEAVE,
      this.broadcastOptions.nsp,
      UID,
      {
        opts: {
          rooms: [...this.rooms],
          except: [...this.exceptRooms],
        },
        rooms: Array.isArray(rooms) ? rooms : [rooms],
      }
    );
  }

  /**
   * Makes the matching socket instances disconnect
   *
   * @param close - whether to close the underlying connection
   * @public
   */
  public async disconnectSockets(close: boolean = false): Promise<void> {
    await publish(
      this.snsClient,
      this.broadcastOptions.topicArn,
      MessageType.DISCONNECT_SOCKETS,
      this.broadcastOptions.nsp,
      UID,
      {
        opts: {
          rooms: [...this.rooms],
          except: [...this.exceptRooms],
        },
        close,
      }
    );
  }
}
