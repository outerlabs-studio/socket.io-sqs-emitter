// @ts-ignore
import { Assertion, stringify as i } from "expect.js";

// add support for Set/Map
const contain = Assertion.prototype.contain;
Assertion.prototype.contain = function (...args) {
  if (typeof this.obj === "object") {
    args.forEach((obj) => {
      this.assert(
        this.obj.has(obj),
        function () {
          return "expected " + i(this.obj) + " to contain " + i(obj);
        },
        function () {
          return "expected " + i(this.obj) + " to not contain " + i(obj);
        },
      );
    });
    return this;
  }
  return contain.apply(this, args);
};

export function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
