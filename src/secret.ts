const inspectCustom = Symbol.for("nodejs.util.inspect.custom");

export class Secret {
  #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toString(): "[redacted]" {
    return "[redacted]";
  }

  toJSON(): "[redacted]" {
    return "[redacted]";
  }

  [inspectCustom](): "[redacted]" {
    return "[redacted]";
  }
}
