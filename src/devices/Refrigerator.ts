import {LGThinQHomebridgePlatform} from '../platform';
import {CharacteristicValue, PlatformAccessory} from 'homebridge';
import {Device} from '../lib/Device';
import {baseDevice} from '../baseDevice';
import {DeviceModel} from "../lib/DeviceModel";

export default class Refrigerator extends baseDevice {
  protected serviceLabel;
  protected serviceFreezer;
  protected serviceFridge;
  protected serviceDoorOpened;
  protected serviceExpressMode;

  constructor(
    protected readonly platform: LGThinQHomebridgePlatform,
    protected readonly accessory: PlatformAccessory,
  ) {
    super(platform, accessory);

    const {
      Service: {
        ContactSensor,
        Switch,
        ServiceLabel,
      },
      Characteristic,
    } = this.platform;
    const device: Device = accessory.context.device;

    this.serviceLabel = accessory.getService(ServiceLabel) || accessory.addService(ServiceLabel, device.name);
    this.serviceLabel.setCharacteristic(Characteristic.ServiceLabelNamespace, Characteristic.ServiceLabelNamespace.DOTS);

    this.serviceFridge = this.createThermostat('Fridge');

    const fridgeValues = Object.values(device.deviceModel.monitoringValue.fridgeTemp_C.valueMapping).filter(value => {
      return value.label !== 'IGNORE';
    }).map(value => {
      return parseInt(value.label);
    });
    this.serviceFridge.getCharacteristic(Characteristic.TargetTemperature)
      .onSet(this.setFridgeTemperature.bind(this))
      .setProps({ minValue: Math.min(...fridgeValues), maxValue: Math.max(...fridgeValues), minStep: 1 });
    this.serviceFridge.updateCharacteristic(Characteristic.ServiceLabelIndex, 1);
    this.serviceFridge.addLinkedService(this.serviceLabel);

    const freezerValues = Object.values(device.deviceModel.monitoringValue.freezerTemp_C.valueMapping).filter(value => {
      return value.label !== 'IGNORE';
    }).map(value => {
      return parseInt(value.label);
    });
    this.serviceFreezer = this.createThermostat('Freezer');
    this.serviceFreezer.getCharacteristic(Characteristic.TargetTemperature)
      .onSet(this.setFreezerTemperature.bind(this))
      .setProps({ minValue: Math.min(...freezerValues), maxValue: Math.max(...freezerValues), minStep: 1 });
    this.serviceFreezer.updateCharacteristic(Characteristic.ServiceLabelIndex, 2);
    this.serviceFreezer.addLinkedService(this.serviceLabel);

    // Door open state
    this.serviceDoorOpened = accessory.getService(ContactSensor) || accessory.addService(ContactSensor, 'Refrigerator Door Closed');
    this.serviceDoorOpened.addLinkedService(this.serviceLabel);

    // Express Mode
    this.serviceExpressMode = accessory.getService(Switch) || accessory.addService(Switch, 'Express Mode');
    this.serviceExpressMode.getCharacteristic(Characteristic.On).onSet(this.setExpressMode.bind(this));
    this.serviceExpressMode.addLinkedService(this.serviceLabel);

    this.updateAccessoryCharacteristic(device);
  }

  public get Status() {
    return new RefrigeratorStatus(this.accessory.context.device.data.snapshot?.refState, this.accessory.context.device.deviceModel);
  }

  /**
   * create a thermostat service
   */
  protected createThermostat(name: string) {
    const {Characteristic} = this.platform;
    const service = this.accessory.getService(name) || this.accessory.addService(this.platform.Service.Thermostat, name, name);
    // cool only
    service.setCharacteristic(Characteristic.CurrentHeatingCoolingState, Characteristic.CurrentHeatingCoolingState.COOL);
    service.getCharacteristic(Characteristic.TargetHeatingCoolingState)
      .setProps({
        minValue: Characteristic.TargetHeatingCoolingState.COOL,
        maxValue: Characteristic.TargetHeatingCoolingState.COOL,
      });
    service.setCharacteristic(Characteristic.TargetHeatingCoolingState, Characteristic.TargetHeatingCoolingState.COOL);
    // celsius only
    service.getCharacteristic(Characteristic.TemperatureDisplayUnits).setProps({
      minValue: Characteristic.TemperatureDisplayUnits.CELSIUS,
      maxValue: Characteristic.TemperatureDisplayUnits.CELSIUS,
    });

    return service;
  }

  /**
   * update accessory characteristic by device
   */
  public updateAccessoryCharacteristic(device: Device) {
    super.updateAccessoryCharacteristic(device);

    const {Characteristic} = this.platform;

    this.serviceFreezer.updateCharacteristic(Characteristic.CurrentTemperature, this.Status.freezerTemperature);
    this.serviceFreezer.updateCharacteristic(Characteristic.TargetTemperature, this.Status.freezerTemperature);

    this.serviceFridge.updateCharacteristic(Characteristic.CurrentTemperature, this.Status.fridgeTemperature);
    this.serviceFridge.updateCharacteristic(Characteristic.TargetTemperature, this.Status.fridgeTemperature);

    const contactSensorValue = this.Status.isDoorClosed ?
      Characteristic.ContactSensorState.CONTACT_DETECTED : Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
    this.serviceDoorOpened.updateCharacteristic(Characteristic.ContactSensorState, contactSensorValue);

    this.serviceExpressMode.updateCharacteristic(Characteristic.On, this.Status.isExpressModeOn);
  }

  async setExpressMode(value: CharacteristicValue) {
    const device: Device = this.accessory.context.device;
    const expressModeValue = value as boolean ? 'EXPRESS_ON' : 'OFF';
    this.platform.ThinQ?.deviceControl(device.id, {
      dataKey: null,
      dataValue: null,
      dataSetList: {
        refState: {
          expressMode: expressModeValue,
          tempUnit: 'CELSIUS',
        },
      },
      dataGetList: null,
    });
    this.platform.log.debug('Set Express Mode ->', value);
  }

  async setFreezerTemperature(value: CharacteristicValue) {
    const device: Device = this.accessory.context.device;
    const freezerTemp = value.toString();
    const freezerValueMapping = device.deviceModel.monitoringValue.fridgeTemp_C.valueMapping;
    const freezerIndex = Object.keys(freezerValueMapping).map(key => {
      return {
        index: key,
        label: freezerValueMapping[key].label,
      };
    }).filter(valueMap => {
      return valueMap.label === freezerTemp;
    });

    if (!freezerIndex.length) {
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.INVALID_VALUE_IN_REQUEST);
    }

    this.platform.ThinQ?.deviceControl(device.id, {
      dataKey: null,
      dataValue: null,
      dataSetList: {
        refState: {
          freezerTemp: freezerIndex[0].index,
          tempUnit: 'CELSIUS',
        },
      },
      dataGetList: null,
    });
  }

  async setFridgeTemperature(value: CharacteristicValue) {
    const device: Device = this.accessory.context.device;
    const fridgeTemp = value.toString();
    const fridgeValueMapping = device.deviceModel.monitoringValue.fridgeTemp_C.valueMapping;
    const fridgeIndex = Object.keys(fridgeValueMapping).map(key => {
      return {
        index: key,
        label: fridgeValueMapping[key].label,
      };
    }).filter(valueMap => {
      return valueMap.label === fridgeTemp;
    });

    if (!fridgeIndex.length) {
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.INVALID_VALUE_IN_REQUEST);
    }

    this.platform.ThinQ?.deviceControl(device.id, {
      dataKey: null,
      dataValue: null,
      dataSetList: {
        refState: {
          fridgeTemp: fridgeIndex[0].index,
          tempUnit: 'CELSIUS',
        },
      },
      dataGetList: null,
    });
  }
}

export class RefrigeratorStatus {
  constructor(protected data, protected deviceModel: DeviceModel) {}

  public get freezerTemperature() {
    const valueMapping = this.deviceModel.monitoringValue.freezerTemp_C.valueMapping;
    return parseInt(valueMapping[this.data?.freezerTemp].label);
  }

  public get fridgeTemperature() {
    const valueMapping = this.deviceModel.monitoringValue.fridgeTemp_C.valueMapping;
    return parseInt(valueMapping[this.data?.fridgeTemp].label);
  }

  public get isDoorClosed() {
    return this.data?.atLeastOneDoorOpen === 'CLOSE';
  }

  public get isExpressModeOn() {
    return this.data?.expressMode === 'EXPRESS_ON';
  }
}
