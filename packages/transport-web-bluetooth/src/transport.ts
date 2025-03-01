import type { Types } from "@meshtastic/core";

export class TransportWebBluetooth implements Types.Transport {
  private _toDevice: WritableStream<Uint8Array>;
  private _fromDevice: ReadableStream<Types.DeviceOutput>;
  private toRadioCharacteristic: BluetoothRemoteGATTCharacteristic;
  private fromRadioCharacteristic: BluetoothRemoteGATTCharacteristic;
  private fromNumCharacteristic: BluetoothRemoteGATTCharacteristic;

  static ToRadioUuid = "f75c76d2-129e-4dad-a1dd-7866124401e7";
  static FromRadioUuid = "2c55e69e-4993-11ed-b878-0242ac120002";
  static FromNumUuid = "ed9da18c-a800-4f66-a670-aa7547e34453";
  static ServiceUuid = "6ba1b218-15a8-461f-9fa8-5dcae273eafd";

  public static async create(): Promise<TransportWebBluetooth> {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [this.ServiceUuid] }],
    });
    return await this.prepareConnection(device);
  }

  public static async createFromDevice(
    device: BluetoothDevice,
  ): Promise<TransportWebBluetooth> {
    console.log("creating from device");
    return await this.prepareConnection(device);
  }

  public static async prepareConnection(
    device: BluetoothDevice,
  ): Promise<TransportWebBluetooth> {
    const gattServer = await device.gatt?.connect();

    if (!gattServer) {
      throw new Error("Failed to connect to GATT server");
    }

    const service = await gattServer.getPrimaryService(this.ServiceUuid);
    console.log("service", service);

    const toRadioCharacteristic = await service.getCharacteristic(
      this.ToRadioUuid,
    );
    const fromRadioCharacteristic = await service.getCharacteristic(
      this.FromRadioUuid,
    );
    const fromNumCharacteristic = await service.getCharacteristic(
      this.FromNumUuid,
    );

    if (
      !toRadioCharacteristic || !fromRadioCharacteristic ||
      !fromNumCharacteristic
    ) {
      throw new Error("Failed to find required characteristics");
    }

    await fromNumCharacteristic.startNotifications();

    console.log("Connected to device", device.name);

    return new TransportWebBluetooth(
      toRadioCharacteristic,
      fromRadioCharacteristic,
      fromNumCharacteristic,
    );
  }

  constructor(
    toRadioCharacteristic: BluetoothRemoteGATTCharacteristic,
    fromRadioCharacteristic: BluetoothRemoteGATTCharacteristic,
    fromNumCharacteristic: BluetoothRemoteGATTCharacteristic,
  ) {
    this.toRadioCharacteristic = toRadioCharacteristic;
    this.fromRadioCharacteristic = fromRadioCharacteristic;
    this.fromNumCharacteristic = fromNumCharacteristic;

    this._toDevice = new WritableStream({
      write: async (chunk) => {
        await this.toRadioCharacteristic.writeValue(chunk);
      },
    });

    let controller: ReadableStreamDefaultController<Types.DeviceOutput>;

    this._fromDevice = new ReadableStream({
      start: (ctrl) => {
        controller = ctrl;
      },
    });

    this.fromNumCharacteristic.addEventListener(
      "characteristicvaluechanged",
      () => this.readFromRadio(controller),
    );
  }

  get toDevice(): WritableStream<Uint8Array> {
    return this._toDevice;
  }

  get fromDevice(): ReadableStream<Types.DeviceOutput> {
    return this._fromDevice;
  }

  protected async readFromRadio(
    controller: ReadableStreamDefaultController<Types.DeviceOutput>,
  ): Promise<void> {
    console.log("reading from radio");
    let hasMoreData = true;
    while (hasMoreData && this.fromRadioCharacteristic) {
      const value = await this.fromRadioCharacteristic.readValue();
      if (value.byteLength === 0) {
        hasMoreData = false;
        continue;
      }
      controller.enqueue({
        type: "packet",
        data: new Uint8Array(value.buffer),
      });
    }
  }
}
