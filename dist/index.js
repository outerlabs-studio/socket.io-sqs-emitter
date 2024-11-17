"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BroadcastOperator = exports.RESERVED_EVENTS = exports.Emitter = void 0;
const socket_io_adapter_1 = require("socket.io-adapter");
const debug_1 = require("debug");
const client_sns_1 = require("@aws-sdk/client-sns");
const notepack_io_1 = require("notepack.io");
const socket_io_parser_1 = require("socket.io-parser");
const debug = (0, debug_1.default)("socket.io-emitter");
const UID = "emitter";
/**
 * Request types, for messages between nodes
 */
var RequestType;
(function (RequestType) {
    RequestType[RequestType["SOCKETS"] = 0] = "SOCKETS";
    RequestType[RequestType["ALL_ROOMS"] = 1] = "ALL_ROOMS";
    RequestType[RequestType["REMOTE_JOIN"] = 2] = "REMOTE_JOIN";
    RequestType[RequestType["REMOTE_LEAVE"] = 3] = "REMOTE_LEAVE";
    RequestType[RequestType["REMOTE_DISCONNECT"] = 4] = "REMOTE_DISCONNECT";
    RequestType[RequestType["REMOTE_FETCH"] = 5] = "REMOTE_FETCH";
    RequestType[RequestType["SERVER_SIDE_EMIT"] = 6] = "SERVER_SIDE_EMIT";
})(RequestType || (RequestType = {}));
async function publish(client, topic, type, nsp, uid, data) {
    try {
        const messageAttributes = {};
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
                BinaryValue: (0, notepack_io_1.encode)(data),
            };
        }
        return client
            .send(new client_sns_1.PublishCommand({
            TopicArn: topic,
            Message: String(type),
            MessageAttributes: messageAttributes,
        }))
            .then(() => {
            debug("published message %d to SNS topic %s", type, topic);
        })
            .catch(console.log);
    }
    catch (e) {
        console.log(e);
    }
}
class Emitter {
    constructor(snsClient, topicArn, nsp = "/") {
        this.snsClient = snsClient;
        this.topicArn = topicArn;
        this.nsp = nsp;
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
    of(nsp) {
        return new Emitter(this.snsClient, this.topicArn, (nsp[0] !== "/" ? "/" : "") + nsp);
    }
    /**
     * Emits to all clients.
     *
     * @return Always true
     * @public
     */
    async emit(ev, ...args) {
        return new BroadcastOperator(this.snsClient, this.broadcastOptions).emit(ev, ...args);
    }
    /**
     * Targets a room when emitting.
     *
     * @param room
     * @return BroadcastOperator
     * @public
     */
    to(room) {
        return new BroadcastOperator(this.snsClient, this.broadcastOptions).to(room);
    }
    /**
     * Targets a room when emitting.
     *
     * @param room
     * @return BroadcastOperator
     * @public
     */
    in(room) {
        return new BroadcastOperator(this.snsClient, this.broadcastOptions).in(room);
    }
    /**
     * Excludes a room when emitting.
     *
     * @param room
     * @return BroadcastOperator
     * @public
     */
    except(room) {
        return new BroadcastOperator(this.snsClient, this.broadcastOptions).except(room);
    }
    /**
     * Sets a modifier for a subsequent event emission that the event data may be lost if the client is not ready to
     * receive messages (because of network slowness or other issues, or because they’re connected through long polling
     * and is in the middle of a request-response cycle).
     *
     * @return BroadcastOperator
     * @public
     */
    get volatile() {
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
    compress(compress) {
        return new BroadcastOperator(this.snsClient, this.broadcastOptions).compress(compress);
    }
    /**
     * Makes the matching socket instances join the specified rooms
     *
     * @param rooms
     * @public
     */
    async socketsJoin(rooms) {
        return new BroadcastOperator(this.snsClient, this.broadcastOptions).socketsJoin(rooms);
    }
    /**
     * Makes the matching socket instances leave the specified rooms
     *
     * @param rooms
     * @public
     */
    async socketsLeave(rooms) {
        return new BroadcastOperator(this.snsClient, this.broadcastOptions).socketsLeave(rooms);
    }
    /**
     * Makes the matching socket instances disconnect
     *
     * @param close - whether to close the underlying connection
     * @public
     */
    async disconnectSockets(close = false) {
        return new BroadcastOperator(this.snsClient, this.broadcastOptions).disconnectSockets(close);
    }
    /**
     * Send a packet to the Socket.IO servers in the cluster
     *
     * @param args - any number of serializable arguments
     */
    async serverSideEmit(...args) {
        const withAck = typeof args[args.length - 1] === "function";
        if (withAck) {
            throw new Error("Acknowledgements are not supported");
        }
        await publish(this.snsClient, this.broadcastOptions.topicArn, socket_io_adapter_1.MessageType.SERVER_SIDE_EMIT, this.broadcastOptions.nsp, UID, {
            packet: args,
        });
    }
}
exports.Emitter = Emitter;
exports.RESERVED_EVENTS = new Set([
    "connect",
    "connect_error",
    "disconnect",
    "disconnecting",
    "newListener",
    "removeListener",
]);
class BroadcastOperator {
    constructor(snsClient, broadcastOptions, rooms = new Set(), exceptRooms = new Set(), flags = {}) {
        this.snsClient = snsClient;
        this.broadcastOptions = broadcastOptions;
        this.rooms = rooms;
        this.exceptRooms = exceptRooms;
        this.flags = flags;
    }
    /**
     * Targets a room when emitting.
     *
     * @param room
     * @return a new BroadcastOperator instance
     * @public
     */
    to(room) {
        const rooms = new Set(this.rooms);
        if (Array.isArray(room)) {
            room.forEach((r) => rooms.add(r));
        }
        else {
            rooms.add(room);
        }
        return new BroadcastOperator(this.snsClient, this.broadcastOptions, rooms, this.exceptRooms, this.flags);
    }
    /**
     * Targets a room when emitting.
     *
     * @param room
     * @return a new BroadcastOperator instance
     * @public
     */
    in(room) {
        return this.to(room);
    }
    /**
     * Excludes a room when emitting.
     *
     * @param room
     * @return a new BroadcastOperator instance
     * @public
     */
    except(room) {
        const exceptRooms = new Set(this.exceptRooms);
        if (Array.isArray(room)) {
            room.forEach((r) => exceptRooms.add(r));
        }
        else {
            exceptRooms.add(room);
        }
        return new BroadcastOperator(this.snsClient, this.broadcastOptions, this.rooms, exceptRooms, this.flags);
    }
    /**
     * Sets the compress flag.
     *
     * @param compress - if `true`, compresses the sending data
     * @return a new BroadcastOperator instance
     * @public
     */
    compress(compress) {
        const flags = Object.assign({}, this.flags, { compress });
        return new BroadcastOperator(this.snsClient, this.broadcastOptions, this.rooms, this.exceptRooms, flags);
    }
    /**
     * Sets a modifier for a subsequent event emission that the event data may be lost if the client is not ready to
     * receive messages (because of network slowness or other issues, or because they’re connected through long polling
     * and is in the middle of a request-response cycle).
     *
     * @return a new BroadcastOperator instance
     * @public
     */
    get volatile() {
        const flags = Object.assign({}, this.flags, { volatile: true });
        return new BroadcastOperator(this.snsClient, this.broadcastOptions, this.rooms, this.exceptRooms, flags);
    }
    /**
     * Emits to all clients.
     *
     * @return Always true
     * @public
     */
    async emit(ev, ...args) {
        if (exports.RESERVED_EVENTS.has(ev)) {
            throw new Error(`"${String(ev)}" is a reserved event name`);
        }
        // set up packet object
        const data = [ev, ...args];
        const packet = {
            type: socket_io_parser_1.PacketType.EVENT,
            data: data,
            nsp: this.broadcastOptions.nsp,
        };
        const opts = {
            rooms: [...this.rooms],
            flags: this.flags,
            except: [...this.exceptRooms],
        };
        await publish(this.snsClient, this.broadcastOptions.topicArn, socket_io_adapter_1.MessageType.BROADCAST, this.broadcastOptions.nsp, UID, {
            packet,
            opts,
        });
        return true;
    }
    /**
     * Makes the matching socket instances join the specified rooms
     *
     * @param rooms
     * @public
     */
    async socketsJoin(rooms) {
        await publish(this.snsClient, this.broadcastOptions.topicArn, socket_io_adapter_1.MessageType.SOCKETS_JOIN, this.broadcastOptions.nsp, UID, {
            opts: {
                rooms: [...this.rooms],
                except: [...this.exceptRooms],
            },
            rooms: Array.isArray(rooms) ? rooms : [rooms],
        });
    }
    /**
     * Makes the matching socket instances leave the specified rooms
     *
     * @param rooms
     * @public
     */
    async socketsLeave(rooms) {
        await publish(this.snsClient, this.broadcastOptions.topicArn, socket_io_adapter_1.MessageType.SOCKETS_LEAVE, this.broadcastOptions.nsp, UID, {
            opts: {
                rooms: [...this.rooms],
                except: [...this.exceptRooms],
            },
            rooms: Array.isArray(rooms) ? rooms : [rooms],
        });
    }
    /**
     * Makes the matching socket instances disconnect
     *
     * @param close - whether to close the underlying connection
     * @public
     */
    async disconnectSockets(close = false) {
        await publish(this.snsClient, this.broadcastOptions.topicArn, socket_io_adapter_1.MessageType.DISCONNECT_SOCKETS, this.broadcastOptions.nsp, UID, {
            opts: {
                rooms: [...this.rooms],
                except: [...this.exceptRooms],
            },
            close,
        });
    }
}
exports.BroadcastOperator = BroadcastOperator;
