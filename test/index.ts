import expect = require("expect.js");
import { Server, Socket } from "socket.io";
import { io as ioc, Socket as ClientSocket } from "socket.io-client";
import { createAdapter } from "@socket.io/aws-sqs-adapter";
import { createServer } from "http";
import { Emitter } from "..";
import type { AddressInfo } from "net";

import "./util";
import { SNS } from "@aws-sdk/client-sns";
import { SQS } from "@aws-sdk/client-sqs";
import { sleep } from "./util";

const SOCKETS_COUNT = 3;

const createPartialDone = (
  count: number,
  done: () => void,
  callback?: () => void
) => {
  let i = 0;
  return () => {
    i++;
    if (i === count) {
      done();
      if (callback) {
        callback();
      }
    }
  };
};

describe("emitter", () => {
  let port: number,
    io: Server,
    snsClient: SNS,
    sqsClient: SQS,
    snsTopicArn: string,
    serverSockets: Socket[],
    clientSockets: ClientSocket[],
    emitter: Emitter;

  beforeEach(async () => {
    const httpServer = createServer();

    const config = {
      endpoint: "http://localhost:4566",
      region: "eu-central-1",
      credentials: { accessKeyId: "dummy", secretAccessKey: "dummy" },
      timeout: 500,
    };
    snsClient = new SNS(config);
    sqsClient = new SQS(config);

    const createTopicCommandOutput = await snsClient.createTopic({
      Name: "socket-io",
    });

    snsTopicArn = createTopicCommandOutput.TopicArn;

    io = new Server(httpServer, {
      adapter: createAdapter(snsClient, sqsClient),
    });

    httpServer.listen(() => {
      port = (httpServer.address() as AddressInfo).port;
      clientSockets = [];
      for (let i = 0; i < SOCKETS_COUNT; i++) {
        clientSockets.push(ioc(`http://localhost:${port}`));
      }
    });

    serverSockets = [];

    emitter = new Emitter(snsClient, snsTopicArn);

    return new Promise((resolve) => {
      io.on("connection", (socket) => {
        serverSockets.push(socket);
        if (serverSockets.length === SOCKETS_COUNT) {
          setTimeout(resolve, 1000);
        }
      });
    });
  });

  afterEach(async () => {
    await sleep(1000);

    io.close();
    clientSockets.forEach((socket) => {
      socket.disconnect();
    });

    const queues = await sqsClient.listQueues({});
    for (const queueUrl of queues?.QueueUrls || []) {
      try {
        await sqsClient.deleteQueue({ QueueUrl: queueUrl });
      } catch (e) {}
    }

    try {
      await snsClient.deleteTopic({ TopicArn: snsTopicArn });
    } catch (e) {}
  });

  it("should be able to emit any kind of data", (done) => {
    const buffer = Buffer.from("asdfasdf", "utf8");
    const arraybuffer = Uint8Array.of(1, 2, 3, 4).buffer;

    clientSockets[0].on("payload", (a, b, c, d, e) => {
      expect(b).to.eql("2");
      expect(c).to.eql([3]);
      expect(d).to.eql(buffer);
      expect(e).to.eql(Buffer.from(arraybuffer)); // buffer on the nodejs client-side
      done();
    });

    emitter.emit("payload", 1, "2", [3], buffer, arraybuffer);
  });

  it("should support the toJSON() method", (done) => {
    // @ts-ignore
    BigInt.prototype.toJSON = function () {
      return String(this);
    };

    // @ts-ignore
    Set.prototype.toJSON = function () {
      return [...this];
    };

    class MyClass {
      toJSON() {
        return 4;
      }
    }

    clientSockets[0].on("payload", (a, b, c) => {
      expect(a).to.eql("1");
      expect(b).to.eql(["2", 3]);
      expect(c).to.eql(4);
      done();
    });

    // @ts-ignore
    emitter.emit("payload", 1n, new Set(["2", 3]), new MyClass());
  });

  it("should support all broadcast modifiers", async () => {
    emitter.in(["room1", "room2"]).emit("test");
    emitter.except(["room4", "room5"]).emit("test");
    emitter.volatile.emit("test");
    emitter.compress(false).emit("test");
    await expect(emitter.emit("connect")).rejects;
  });

  describe("in namespaces", () => {
    it("should be able to emit messages to client", (done) => {
      clientSockets[0].on("broadcast event", (payload) => {
        expect(payload).to.eql("broadcast payload");
        done();
      });

      emitter.emit("broadcast event", "broadcast payload");
    });

    it("should be able to emit message to namespace", (done) => {
      io.of("/custom");

      const clientSocket = ioc(`http://localhost:${port}/custom`);

      clientSocket.on("broadcast event", (payload) => {
        expect(payload).to.eql("broadcast payload");
        clientSocket.disconnect();
        done();
      });

      clientSockets[0].on("broadcast event", () => {
        expect().fail();
      });

      clientSocket.on("connect", () => {
        emitter.of("/custom").emit("broadcast event", "broadcast payload");
      });
    });

    it("should prepend a missing / to the namespace name", () => {
      const emitter = new Emitter(snsClient, snsTopicArn);
      const custom = emitter.of("custom"); // missing "/"
      expect(emitter.nsp).to.eql("/");
      expect(custom.nsp).to.eql("/custom");
    });
  });

  describe("in rooms", () => {
    it("should be able to emit to a room", (done) => {
      serverSockets[0].join("room1");
      serverSockets[1].join("room2");

      clientSockets[0].on("broadcast event", () => {
        done();
      });

      clientSockets[1].on("broadcast event", () => {
        expect().fail();
      });

      emitter.to("room1").emit("broadcast event", "broadcast payload");
    });

    it("should be able to emit to a socket by id", (done) => {
      clientSockets[0].on("broadcast event", () => {
        done();
      });

      clientSockets[1].on("broadcast event", () => {
        expect().fail();
      });

      emitter
        .to(serverSockets[0].id)
        .emit("broadcast event", "broadcast payload");
    });

    it("should be able to exclude a socket by id", (done) => {
      clientSockets[0].on("broadcast event", () => {
        done();
      });

      clientSockets[1].on("broadcast event", () => {
        expect().fail();
      });

      emitter
        .except(serverSockets[1].id)
        .emit("broadcast event", "broadcast payload");
    });
  });

  describe("utility methods", () => {
    describe("socketsJoin", () => {
      it("makes all socket instances join the given room", (done) => {
        emitter.socketsJoin("room1");

        setTimeout(() => {
          serverSockets.forEach((socket) => {
            expect(socket.rooms).to.contain("room1");
          });
          done();
        }, 1000);
      });

      it("makes all socket instances in a room join the given room", (done) => {
        serverSockets[0].join(["room1", "room2"]);
        serverSockets[1].join("room1");
        serverSockets[2].join("room2");

        emitter.in("room1").socketsJoin("room3");

        setTimeout(() => {
          expect(serverSockets[0].rooms).to.contain("room3");
          expect(serverSockets[1].rooms).to.contain("room3");
          expect(serverSockets[2].rooms).to.not.contain("room3");
          done();
        }, 1000);
      });
    });

    describe("socketsLeave", () => {
      it("makes all socket instances leave the given room", (done) => {
        serverSockets[0].join(["room1", "room2"]);
        serverSockets[1].join("room1");
        serverSockets[2].join("room2");

        emitter.socketsLeave("room1");

        setTimeout(() => {
          expect(serverSockets[0].rooms).to.contain("room2");
          expect(serverSockets[0].rooms).to.not.contain("room1");
          expect(serverSockets[1].rooms).to.not.contain("room1");
          done();
        }, 1000);
      });

      it("makes all socket instances in a room leave the given room", (done) => {
        serverSockets[0].join(["room1", "room2"]);
        serverSockets[1].join("room1");
        serverSockets[2].join("room2");

        emitter.in("room2").socketsLeave("room1");

        setTimeout(() => {
          expect(serverSockets[0].rooms).to.contain("room2");
          expect(serverSockets[0].rooms).to.not.contain("room1");
          expect(serverSockets[1].rooms).to.contain("room1");
          done();
        }, 1000);
      });
    });

    describe("disconnectSockets", () => {
      it("makes all socket instances disconnect", (done) => {
        emitter.disconnectSockets(true);

        const partialDone = createPartialDone(3, done);

        clientSockets[0].on("disconnect", partialDone);
        clientSockets[1].on("disconnect", partialDone);
        clientSockets[2].on("disconnect", partialDone);
      });

      it("makes all socket instances in a room disconnect", (done) => {
        serverSockets[0].join(["room1", "room2"]);
        serverSockets[1].join("room1");
        serverSockets[2].join("room2");
        emitter.in("room2").disconnectSockets(true);

        const partialDone = createPartialDone(2, done, () => {
          clientSockets[1].off("disconnect");
        });

        clientSockets[0].on("disconnect", partialDone);
        clientSockets[1].on("disconnect", () => {
          done(new Error("should not happen"));
        });
        clientSockets[2].on("disconnect", partialDone);
      });
    });

    describe("serverSideEmit", () => {
      it("sends an event to other server instances", (done) => {
        emitter.serverSideEmit("hello", "world", 1, "2");

        io.on("hello", (arg1, arg2, arg3) => {
          expect(arg1).to.eql("world");
          expect(arg2).to.eql(1);
          expect(arg3).to.eql("2");
          done();
        });
      });
    });
  });
});
