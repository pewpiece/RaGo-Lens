import { useEffect, useRef, useState } from 'react';
import { Accelerometer, LightSensor } from 'expo-sensors';
import { LOW_LIGHT_LUX, ShakeMeter, levelFromAccel, type LevelReading } from './level';

export interface SensorState {
  level: LevelReading | null;
  shaky: boolean;
  lux: number | null;
  lowLight: boolean;
}

const NONE: SensorState = { level: null, shaky: false, lux: null, lowLight: false };

/**
 * Accelerometer (level + steadiness) and ambient light sensor (low light) while `active`. Every sensor is optional:
 * if one is missing or refuses to start, its readings stay empty and the camera works as before.
 */
export function useCaptureSensors(active: boolean): SensorState {
  const [state, setState] = useState<SensorState>(NONE);
  const shake = useRef(new ShakeMeter());
  useEffect(() => {
    if (!active) return;
    const subs: { remove: () => void }[] = [];
    let alive = true;
    (async () => {
      try {
        if (await Accelerometer.isAvailableAsync()) {
          Accelerometer.setUpdateInterval(120);
          subs.push(
            Accelerometer.addListener(({ x, y, z }) => {
              shake.current.push(x, y, z);
              if (alive)
                setState((s) => ({
                  ...s,
                  level: levelFromAccel(x, y, z),
                  shaky: shake.current.shaky,
                }));
            }),
          );
        }
      } catch {
        /* no accelerometer: no level indicator */
      }
      try {
        if (await LightSensor.isAvailableAsync()) {
          LightSensor.setUpdateInterval(700);
          subs.push(
            LightSensor.addListener(({ illuminance }) => {
              if (alive)
                setState((s) => ({
                  ...s,
                  lux: illuminance,
                  lowLight: illuminance < LOW_LIGHT_LUX,
                }));
            }),
          );
        }
      } catch {
        /* no light sensor: no low-light warning */
      }
    })();
    return () => {
      alive = false;
      subs.forEach((s) => s.remove());
    };
  }, [active]);
  return active ? state : NONE;
}
