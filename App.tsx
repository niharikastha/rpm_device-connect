import React, { useState, useEffect } from 'react';
import { PermissionsAndroid, Platform, Button, FlatList, Text, View, TouchableOpacity, Alert } from 'react-native';
import { BleManager, Device, Characteristic } from 'react-native-ble-plx';
import { Buffer } from 'buffer'; // For encoding/decoding base64

const manager = new BleManager();

const App: React.FC = () => {
  const [devices, setDevices] = useState<Device[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [servicesWithCharacteristics, setServicesWithCharacteristics] = useState<any[]>([]);
  const [oximeterData, setOximeterData] = useState({ spo2: '', pulseRate: '' });

  // Function to start scanning for nearby Bluetooth devices
  const startScan = () => {
    if (isScanning) {
      Alert.alert('Scanning', 'Already scanning for devices.');
      return;
    }

    setDevices([]);
    setIsScanning(true);

    manager.startDeviceScan(null, null, (error, device) => {
      if (error) {
        console.error('Error while scanning:', error);
        Alert.alert('Error', 'Failed to scan for devices.');
        setIsScanning(false);
        return;
      }

      if (device && (device.name || device.localName)) {
        setDevices((prevDevices) => {
          const exists = prevDevices.find((d) => d.id === device.id);
          if (!exists) {
            return [...prevDevices, device];
          }
          return prevDevices;
        });
      }
    });

    setTimeout(() => {
      manager.stopDeviceScan();
      setIsScanning(false);
      console.log('Scanning stopped.');
    }, 30000); // 10 seconds
  };

  const connectToDevice = async (device: Device) => {
    try {
      const connectedDevice = await manager.connectToDevice(device.id);
      setConnectedDevice(connectedDevice);
      console.log('Connected to device:', connectedDevice);

      await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait for the connection to stabilize
      const deviceWithServices = await connectedDevice.discoverAllServicesAndCharacteristics();
      const services = await deviceWithServices.services();

      const allServicesWithCharacteristics: any[] = [];

      for (const service of services) {
        const chars = await connectedDevice.characteristicsForService(service.uuid);
        allServicesWithCharacteristics.push({
          serviceUuid: service.uuid,
          characteristics: chars,
        });

        chars.forEach((characteristic: any) => {
          if (characteristic.isNotifiable) {
            console.log(`Subscribing to notifications for characteristic: ${characteristic.uuid}`);

            manager.monitorCharacteristicForDevice(
              device.id,
              characteristic.serviceUUID,
              characteristic.uuid,
              (error, char) => {
                if (error) {
                  console.error('Monitor characteristic error:', error);
                  return;
                }

                if (char?.value) {
                  const decodedValue = Buffer.from(char.value, 'base64').toString('utf-8');
                  console.log("Received value:", decodedValue);

                  try {
                    const data = JSON.parse(decodedValue);
                    setOximeterData({ spo2: data.spo2 || '', pulseRate: data.pulseRate || '' });
                  } catch (error) {
                    console.error('Error parsing data:', error);
                  }
                }
              }
            );
          }
          if (characteristic.isReadable) {
            connectedDevice.readCharacteristicForService(characteristic.serviceUUID, characteristic.uuid)
              .then((char) => {
                console.log('Read characteristic value:', char?.value);
                if (char?.value) {
                  const decodedValue = Buffer.from(char.value, 'base64');
                  console.log("🚀 ~ //.then ~ decodedValue:", decodedValue)
                }
              })
              .catch(error => {
                console.error('Read characteristic error:', error);
              });
          }
        });
      }

      setServicesWithCharacteristics(allServicesWithCharacteristics);
      Alert.alert('Success', `Connected to ${connectedDevice.name || 'Unnamed Device'}`);
    } catch (error) {
      console.error('Connection error:', error);
      Alert.alert('Connection Error', `Failed to connect: ${error.message}`);
    }
  };

  const reconnectToDevice = async () => {
    try {
      if (connectedDevice) {
        console.log(`Attempting to reconnect to device ${connectedDevice.id}`);
        await manager.connectToDevice(connectedDevice.id);
        await connectedDevice.discoverAllServicesAndCharacteristics();
        console.log('Reconnected successfully!');
      }
    } catch (error) {
      console.error('Reconnection failed:', error);
    }
  };

  useEffect(() => {
    const requestPermissions = async () => {
      if (Platform.OS === 'android') {
        const apiLevel = parseInt(Platform.Version.toString(), 10);

        const permissions = [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ];

        if (apiLevel < 31) {
          permissions.push(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
        }

        const result = await PermissionsAndroid.requestMultiple(permissions);

        const allGranted = permissions.every(
          (permission) => result[permission] === PermissionsAndroid.RESULTS.GRANTED
        );

        if (!allGranted) {
          Alert.alert('Permission Denied', 'Bluetooth and Location permissions are required.');
        }
      }
    };

    requestPermissions();

    return () => {
      manager.destroy();
    };
  }, []);

  useEffect(() => {
    const handleDisconnected = (deviceId: string) => {
      console.log('Disconnected from device:', deviceId);
      setConnectedDevice(null);
      setOximeterData({ spo2: '', pulseRate: '' });
    };

    if (connectedDevice) {
      const subscription = manager.onDeviceDisconnected(connectedDevice.id, handleDisconnected);

      return () => {
        subscription.remove();
      };
    }
  }, [connectedDevice]);

  return (
    <View style={{ flex: 1, padding: 20, justifyContent: 'center', alignItems: 'center' }}>
      <Button title="Scan for Bluetooth Devices" onPress={startScan} disabled={isScanning} />

      <FlatList
        data={devices}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => connectToDevice(item)} style={{ padding: 10, borderBottomWidth: 1 }}>
            <Text style={{ fontSize: 16 }}>
              {item.name || item.localName || 'Unnamed Device'} ({item.id})
            </Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={{ marginTop: 20 }}>No devices found.</Text>}
        style={{ width: '100%', marginTop: 20 }}
      />

      {connectedDevice && (
        <View style={{ marginTop: 20, width: '100%' }}>
          <Text style={{ fontSize: 18, fontWeight: 'bold' }}>
            Connected to: {connectedDevice.name || 'Unnamed Device'}
          </Text>

          <View style={{ marginTop: 20 }}>
            <Text style={{ fontSize: 16 }}>SpO2: {oximeterData.spo2}</Text>
            <Text style={{ fontSize: 16 }}>Pulse Rate: {oximeterData.pulseRate}</Text>
          </View>
        </View>
      )}
    </View>
  );
};

export default App;
